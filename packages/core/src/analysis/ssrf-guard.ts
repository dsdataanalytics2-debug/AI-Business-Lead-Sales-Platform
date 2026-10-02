/**
 * SSRF Guard & Globally-Routable IP Classifier
 *
 * Implements strict, zero-trust validation for target URLs and resolved IP addresses.
 * Enforces positive policy: ALLOW ONLY globally routable unicast IP addresses.
 *
 * Rejects:
 * - Private / Local / Internal hostnames (localhost, *.local, *.internal, etc.)
 * - Non-HTTP/HTTPS schemes (file:, ftp:, javascript:, etc.)
 * - URLs with user credentials (http://user:pass@host)
 * - IPv4 private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - IPv4 loopback (127.0.0.0/8)
 * - IPv4 link-local & cloud metadata (169.254.0.0/16, 169.254.169.254)
 * - IPv4 CGNAT (100.64.0.0/10), Broadcast (0.0.0.0/8, 255.255.255.255), Multicast (224.0.0.0/4), Reserved (240.0.0.0/4)
 * - IPv4 documentation & benchmark (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 198.18.0.0/15)
 * - IPv6 loopback (::1), Unspecified (::), ULA (fc00::/7), Link-local (fe80::/10), Multicast (ff00::/8), Doc (2001:db8::/32)
 * - IPv4-mapped IPv6 (::ffff:0:0/96), 6to4 (2002::/16), NAT64 (64:ff9b::/96) evaluated against IPv4 policy
 * - Mixed DNS resolution results (if ANY returned IP is restricted, entire host is blocked)
 */

import net from 'net';
import dns from 'dns';

export interface IpValidationResult {
  isValid: boolean;
  isGloballyRoutable: boolean;
  ip: string;
  family: 4 | 6;
  reason: string | null;
}

export interface UrlValidationResult {
  isValid: boolean;
  url: URL | null;
  hostname: string | null;
  isHttps: boolean;
  error: 'NOT_APPLICABLE' | 'INVALID_URL' | 'BLOCKED_SSRF' | null;
  reason: string | null;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type DnsLookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

// =========================================================
// IPv4 Subnet Ranges & Helper Functions
// =========================================================

export function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const p = Number(parts[i]);
    if (!Number.isInteger(p) || p < 0 || p > 255 || parts[i].trim() !== String(p)) {
      return null;
    }
    num = ((num << 8) | p) >>> 0;
  }
  return num;
}

export function uint32ToIpv4(ipInt: number): string {
  return [
    (ipInt >>> 24) & 0xff,
    (ipInt >>> 16) & 0xff,
    (ipInt >>> 8) & 0xff,
    ipInt & 0xff
  ].join('.');
}

function ipv4InCidr(ipInt: number, cidrBase: string, prefixLen: number): boolean {
  const baseInt = ipv4ToUint32(cidrBase);
  if (baseInt === null) return false;
  if (prefixLen === 0) return true;
  const mask = ((~0 << (32 - prefixLen)) >>> 0);
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_IPV4_RANGES: Array<{ cidr: string; prefix: number; name: string }> = [
  { cidr: '0.0.0.0', prefix: 8, name: 'Current network (0.0.0.0/8)' },
  { cidr: '10.0.0.0', prefix: 8, name: 'Private Class A (10.0.0.0/8)' },
  { cidr: '100.64.0.0', prefix: 10, name: 'Carrier-grade NAT (100.64.0.0/10)' },
  { cidr: '127.0.0.0', prefix: 8, name: 'Loopback (127.0.0.0/8)' },
  { cidr: '169.254.0.0', prefix: 16, name: 'Link-local / Cloud Metadata (169.254.0.0/16)' },
  { cidr: '172.16.0.0', prefix: 12, name: 'Private Class B (172.16.0.0/12)' },
  { cidr: '192.0.0.0', prefix: 24, name: 'IETF Protocol Assignments (192.0.0.0/24)' },
  { cidr: '192.0.2.0', prefix: 24, name: 'TEST-NET-1 Documentation (192.0.2.0/24)' },
  { cidr: '192.168.0.0', prefix: 16, name: 'Private Class C (192.168.0.0/16)' },
  { cidr: '198.18.0.0', prefix: 15, name: 'Benchmark Testing (198.18.0.0/15)' },
  { cidr: '198.51.100.0', prefix: 24, name: 'TEST-NET-2 Documentation (198.51.100.0/24)' },
  { cidr: '203.0.113.0', prefix: 24, name: 'TEST-NET-3 Documentation (203.0.113.0/24)' },
  { cidr: '224.0.0.0', prefix: 4, name: 'Multicast (224.0.0.0/4)' },
  { cidr: '240.0.0.0', prefix: 4, name: 'Reserved (240.0.0.0/4)' },
  { cidr: '255.255.255.255', prefix: 32, name: 'Limited Broadcast (255.255.255.255/32)' }
];

function checkIpv4Uint32(ipInt: number): { isGloballyRoutable: boolean; reason: string | null } {
  for (const range of BLOCKED_IPV4_RANGES) {
    if (ipv4InCidr(ipInt, range.cidr, range.prefix)) {
      return {
        isGloballyRoutable: false,
        reason: `Blocked non-global IPv4 range: ${range.name}`
      };
    }
  }
  return { isGloballyRoutable: true, reason: null };
}

// =========================================================
// IPv6 Subnet & Range Helper Functions
// =========================================================

export function expandIPv6(ip: string): number[] | null {
  let normalized = ip.toLowerCase();

  // If dotted-decimal IPv4 is at the end (e.g. ::ffff:192.168.1.1 or fe80::192.168.1.1)
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon !== -1) {
    const tail = normalized.slice(lastColon + 1);
    if (net.isIPv4(tail)) {
      const v4Int = ipv4ToUint32(tail);
      if (v4Int === null) return null;
      const w1 = ((v4Int >>> 16) & 0xffff).toString(16);
      const w2 = (v4Int & 0xffff).toString(16);
      normalized = normalized.slice(0, lastColon + 1) + w1 + ':' + w2;
    }
  }

  const parts = normalized.split(':');
  let fullParts: string[] = [];

  const doubleColonIndex = parts.indexOf('');
  if (doubleColonIndex !== -1) {
    const head = parts.slice(0, doubleColonIndex).filter((p) => p.length > 0);
    const tail = parts.slice(doubleColonIndex + 1).filter((p) => p.length > 0);
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    const fill = new Array(missing).fill('0');
    fullParts = [...head, ...fill, ...tail];
  } else {
    fullParts = parts;
  }

  if (fullParts.length !== 8) return null;

  const hex16s: number[] = [];
  for (const part of fullParts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    hex16s.push(parseInt(part, 16));
  }
  return hex16s;
}

// =========================================================
// Global IP Classifier Function
// =========================================================

export function isGloballyRoutableIp(ipStr: string): IpValidationResult {
  let trimmed = typeof ipStr === 'string' ? ipStr.trim() : '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    trimmed = trimmed.slice(1, -1);
  }

  // 1. IPv4 Evaluation
  if (net.isIPv4(trimmed)) {
    const ipInt = ipv4ToUint32(trimmed);
    if (ipInt === null) {
      return { isValid: false, isGloballyRoutable: false, ip: trimmed, family: 4, reason: 'Malformed IPv4 format' };
    }

    const check = checkIpv4Uint32(ipInt);
    return {
      isValid: true,
      isGloballyRoutable: check.isGloballyRoutable,
      ip: trimmed,
      family: 4,
      reason: check.reason
    };
  }

  // 2. IPv6 Evaluation
  if (net.isIPv6(trimmed)) {
    const lower = trimmed.toLowerCase();

    // Direct string checks for well-known single addresses
    if (lower === '::' || lower === '::0') {
      return { isValid: true, isGloballyRoutable: false, ip: trimmed, family: 6, reason: 'Unspecified IPv6 address (::)' };
    }
    if (lower === '::1') {
      return { isValid: true, isGloballyRoutable: false, ip: trimmed, family: 6, reason: 'Loopback IPv6 address (::1)' };
    }

    const hex16s = expandIPv6(lower);
    if (!hex16s) {
      return { isValid: false, isGloballyRoutable: false, ip: trimmed, family: 6, reason: 'Malformed IPv6 address' };
    }

    // Check IPv4-mapped IPv6 (::ffff:0:0/96)
    if (
      hex16s[0] === 0 &&
      hex16s[1] === 0 &&
      hex16s[2] === 0 &&
      hex16s[3] === 0 &&
      hex16s[4] === 0 &&
      hex16s[5] === 0xffff
    ) {
      const embeddedV4Int = ((hex16s[6] << 16) | hex16s[7]) >>> 0;
      const v4Check = checkIpv4Uint32(embeddedV4Int);
      return {
        isValid: true,
        isGloballyRoutable: v4Check.isGloballyRoutable,
        ip: trimmed,
        family: 6,
        reason: v4Check.isGloballyRoutable
          ? null
          : `IPv4-mapped IPv6 (${uint32ToIpv4(embeddedV4Int)}): ${v4Check.reason}`
      };
    }

    // Check 6to4 (2002::/16) embedding IPv4 in words 1 and 2
    if (hex16s[0] === 0x2002) {
      const embeddedV4Int = ((hex16s[1] << 16) | hex16s[2]) >>> 0;
      const v4Check = checkIpv4Uint32(embeddedV4Int);
      if (!v4Check.isGloballyRoutable) {
        return {
          isValid: true,
          isGloballyRoutable: false,
          ip: trimmed,
          family: 6,
          reason: `6to4 IPv6 (${uint32ToIpv4(embeddedV4Int)}): ${v4Check.reason}`
        };
      }
    }

    // Check NAT64 well-known prefix (64:ff9b::/96)
    if (
      hex16s[0] === 0x0064 &&
      hex16s[1] === 0xff9b &&
      hex16s[2] === 0 &&
      hex16s[3] === 0 &&
      hex16s[4] === 0 &&
      hex16s[5] === 0
    ) {
      const embeddedV4Int = ((hex16s[6] << 16) | hex16s[7]) >>> 0;
      const v4Check = checkIpv4Uint32(embeddedV4Int);
      if (!v4Check.isGloballyRoutable) {
        return {
          isValid: true,
          isGloballyRoutable: false,
          ip: trimmed,
          family: 6,
          reason: `NAT64 IPv6 (${uint32ToIpv4(embeddedV4Int)}): ${v4Check.reason}`
        };
      }
    }

    const firstWord = hex16s[0];

    // fc00::/7 (Unique Local Address - fc00:: - fdff::)
    if ((firstWord & 0xfe00) === 0xfc00) {
      return { isValid: true, isGloballyRoutable: false, ip: trimmed, family: 6, reason: 'Unique Local IPv6 address (fc00::/7)' };
    }

    // fe80::/10 (Link-local unicast - fe80:: - febf::)
    if ((firstWord & 0xffc0) === 0xfe80) {
      return { isValid: true, isGloballyRoutable: false, ip: trimmed, family: 6, reason: 'Link-local IPv6 address (fe80::/10)' };
    }

    // ff00::/8 (Multicast)
    if ((firstWord & 0xff00) === 0xff00) {
      return { isValid: true, isGloballyRoutable: false, ip: trimmed, family: 6, reason: 'Multicast IPv6 address (ff00::/8)' };
    }

    // 2001:db8::/32 (Documentation)
    if (firstWord === 0x2001 && hex16s[1] === 0x0db8) {
      return { isValid: true, isGloballyRoutable: false, ip: trimmed, family: 6, reason: 'Documentation IPv6 address (2001:db8::/32)' };
    }

    return { isValid: true, isGloballyRoutable: true, ip: trimmed, family: 6, reason: null };
  }

  return {
    isValid: false,
    isGloballyRoutable: false,
    ip: trimmed,
    family: 4,
    reason: 'Not a valid IPv4 or IPv6 literal'
  };
}

// =========================================================
// Hostname & URL Validation
// =========================================================

const BLOCKED_HOSTNAMES = new Set(['localhost']);
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp'];

export function validateTargetUrl(rawUrl?: string | null): UrlValidationResult {
  if (rawUrl === undefined || rawUrl === null) {
    return { isValid: false, url: null, hostname: null, isHttps: false, error: 'NOT_APPLICABLE', reason: 'URL is null or undefined' };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { isValid: false, url: null, hostname: null, isHttps: false, error: 'NOT_APPLICABLE', reason: 'URL is empty' };
  }

  // Check scheme before parsing
  let urlToParse = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    urlToParse = 'https://' + trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlToParse);
  } catch {
    return { isValid: false, url: null, hostname: null, isHttps: false, error: 'INVALID_URL', reason: 'Malformed URL syntax' };
  }

  // 1. Enforce allowed schemes: only http: and https:
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isValid: false, url: null, hostname: null, isHttps: false, error: 'INVALID_URL', reason: `Unsupported protocol: "${parsed.protocol}"` };
  }

  // 2. Reject URLs with credentials (user:pass@)
  if (parsed.username || parsed.password) {
    return { isValid: false, url: null, hostname: null, isHttps: false, error: 'INVALID_URL', reason: 'URL contains embedded credentials' };
  }

  let hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { isValid: false, url: null, hostname: null, isHttps: false, error: 'INVALID_URL', reason: 'Missing hostname' };
  }

  // Unwrap IPv6 hostname brackets if present
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // 3. Reject prohibited private hostnames
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { isValid: false, url: null, hostname, isHttps: parsed.protocol === 'https:', error: 'BLOCKED_SSRF', reason: `Blocked private hostname: "${hostname}"` };
  }

  // 4. If hostname is a direct IP literal, validate directly
  if (net.isIP(hostname)) {
    const ipCheck = isGloballyRoutableIp(hostname);
    if (!ipCheck.isGloballyRoutable) {
      return {
        isValid: false,
        url: null,
        hostname,
        isHttps: parsed.protocol === 'https:',
        error: 'BLOCKED_SSRF',
        reason: ipCheck.reason
      };
    }
  } else {
    // Standard domain: ensure it contains at least one dot (reject single-label internal hosts like "router")
    if (!hostname.includes('.')) {
      return { isValid: false, url: null, hostname, isHttps: parsed.protocol === 'https:', error: 'INVALID_URL', reason: `Single-label hostnames without TLD are rejected: "${hostname}"` };
    }
  }

  return {
    isValid: true,
    url: parsed,
    hostname,
    isHttps: parsed.protocol === 'https:',
    error: null,
    reason: null
  };
}

// =========================================================
// Default Real DNS Lookup Implementation
// =========================================================

export const defaultDnsLookup: DnsLookupFn = async (hostname: string): Promise<ResolvedAddress[]> => {
  let cleanHost = hostname;
  if (cleanHost.startsWith('[') && cleanHost.endsWith(']')) {
    cleanHost = cleanHost.slice(1, -1);
  }
  const results = await dns.promises.lookup(cleanHost, { all: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
};

// =========================================================
// SSRF Pre-Flight DNS Resolution & IP Pinning
// =========================================================

export interface ResolvedTarget {
  success: boolean;
  pinnedIp: string | null;
  family: number | null;
  error: 'BLOCKED_SSRF' | 'UNREACHABLE' | null;
  reason: string | null;
}

export async function resolveAndValidateHost(
  hostname: string,
  lookupFn: DnsLookupFn = defaultDnsLookup
): Promise<ResolvedTarget> {
  let cleanHost = hostname;
  if (cleanHost.startsWith('[') && cleanHost.endsWith(']')) {
    cleanHost = cleanHost.slice(1, -1);
  }

  // If hostname is already an IP literal
  if (net.isIP(cleanHost)) {
    const ipCheck = isGloballyRoutableIp(cleanHost);
    if (!ipCheck.isGloballyRoutable) {
      return { success: false, pinnedIp: null, family: null, error: 'BLOCKED_SSRF', reason: ipCheck.reason };
    }
    return { success: true, pinnedIp: cleanHost, family: net.isIP(cleanHost), error: null, reason: null };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookupFn(cleanHost);
  } catch (err: any) {
    const code = err?.code;
    return {
      success: false,
      pinnedIp: null,
      family: null,
      error: 'UNREACHABLE',
      reason: `DNS resolution failed: ${code || err?.message || 'unknown error'}`
    };
  }

  if (!addresses || addresses.length === 0) {
    return {
      success: false,
      pinnedIp: null,
      family: null,
      error: 'UNREACHABLE',
      reason: 'DNS lookup returned 0 addresses'
    };
  }

  // Mixed DNS check: evaluate ALL returned addresses. If ANY address is non-global, reject the entire host!
  for (const addr of addresses) {
    const check = isGloballyRoutableIp(addr.address);
    if (!check.isGloballyRoutable) {
      return {
        success: false,
        pinnedIp: null,
        family: null,
        error: 'BLOCKED_SSRF',
        reason: `DNS returned non-global address (${addr.address}): ${check.reason}`
      };
    }
  }

  // Deterministically pin the first validated globally-routable address
  const pinned = addresses[0];
  return {
    success: true,
    pinnedIp: pinned.address,
    family: pinned.family,
    error: null,
    reason: null
  };
}
