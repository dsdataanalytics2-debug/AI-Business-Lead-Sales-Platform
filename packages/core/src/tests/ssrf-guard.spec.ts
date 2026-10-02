import { describe, it, expect } from 'vitest';
import {
  isGloballyRoutableIp,
  validateTargetUrl,
  resolveAndValidateHost,
  type ResolvedAddress
} from '../analysis/ssrf-guard.js';

describe('SSRF Guard & Global IP Classifier', () => {
  describe('IPv4 Global Unicast Classification', () => {
    const blockedIpv4Samples = [
      { ip: '127.0.0.1', desc: 'Loopback' },
      { ip: '127.255.255.254', desc: 'Loopback range end' },
      { ip: '10.0.0.1', desc: 'Private Class A' },
      { ip: '10.254.1.1', desc: 'Private Class A subnet' },
      { ip: '172.16.0.1', desc: 'Private Class B start' },
      { ip: '172.31.255.254', desc: 'Private Class B end' },
      { ip: '192.168.1.1', desc: 'Private Class C' },
      { ip: '192.168.254.254', desc: 'Private Class C subnet' },
      { ip: '169.254.169.254', desc: 'AWS/GCP/Azure Cloud Metadata' },
      { ip: '169.254.1.1', desc: 'IPv4 Link-Local' },
      { ip: '100.64.0.1', desc: 'Carrier-Grade NAT (RFC 6598)' },
      { ip: '100.127.255.254', desc: 'Carrier-Grade NAT end' },
      { ip: '0.0.0.0', desc: 'Current network source' },
      { ip: '0.1.2.3', desc: 'Current network range' },
      { ip: '224.0.0.1', desc: 'IPv4 Multicast' },
      { ip: '239.255.255.250', desc: 'IPv4 Multicast SSDP' },
      { ip: '198.18.0.1', desc: 'Benchmark network' },
      { ip: '192.0.2.1', desc: 'TEST-NET-1 (RFC 5737)' },
      { ip: '198.51.100.1', desc: 'TEST-NET-2 (RFC 5737)' },
      { ip: '203.0.113.1', desc: 'TEST-NET-3 (RFC 5737)' },
      { ip: '240.0.0.1', desc: 'Reserved Class E' },
      { ip: '255.255.255.255', desc: 'Limited Broadcast' }
    ];

    for (const sample of blockedIpv4Samples) {
      it(`blocks restricted IPv4: ${sample.ip} (${sample.desc})`, () => {
        const result = isGloballyRoutableIp(sample.ip);
        expect(result.isValid).toBe(true);
        expect(result.isGloballyRoutable).toBe(false);
        expect(result.reason).toBeTruthy();
      });
    }

    const validPublicIpv4Samples = [
      '93.184.216.34', // example.com
      '8.8.8.8', // Google Public DNS
      '1.1.1.1', // Cloudflare DNS
      '151.101.1.69', // Fastly CDN
      '104.26.10.228', // Cloudflare Edge
      '142.250.190.46', // Google
      '13.107.42.14' // Microsoft
    ];

    for (const ip of validPublicIpv4Samples) {
      it(`accepts globally routable public IPv4: ${ip}`, () => {
        const result = isGloballyRoutableIp(ip);
        expect(result.isValid).toBe(true);
        expect(result.isGloballyRoutable).toBe(true);
        expect(result.reason).toBeNull();
      });
    }
  });

  describe('IPv6 Global Unicast Classification', () => {
    const blockedIpv6Samples = [
      { ip: '::1', desc: 'IPv6 Loopback' },
      { ip: '::', desc: 'IPv6 Unspecified' },
      { ip: '::0', desc: 'IPv6 Unspecified zero' },
      { ip: 'fc00::1', desc: 'IPv6 Unique Local Address (ULA)' },
      { ip: 'fd12:3456:789a::1', desc: 'IPv6 Unique Local Address (ULA)' },
      { ip: 'fe80::1', desc: 'IPv6 Link-Local Unicast' },
      { ip: 'febf::ffff', desc: 'IPv6 Link-Local Unicast end' },
      { ip: 'ff02::1', desc: 'IPv6 Multicast all nodes' },
      { ip: 'ff05::2', desc: 'IPv6 Multicast site-local' },
      { ip: '2001:db8::1', desc: 'IPv6 Documentation (RFC 3849)' },
      { ip: '2001:0db8:85a3::8a2e:0370:7334', desc: 'IPv6 Documentation full' },
      { ip: '::ffff:127.0.0.1', desc: 'IPv4-mapped IPv6 loopback' },
      { ip: '::ffff:10.0.0.1', desc: 'IPv4-mapped IPv6 Private Class A' },
      { ip: '::ffff:192.168.1.1', desc: 'IPv4-mapped IPv6 Private Class C' },
      { ip: '::ffff:169.254.169.254', desc: 'IPv4-mapped IPv6 Cloud Metadata' },
      { ip: '::ffff:7f00:0001', desc: 'IPv4-mapped IPv6 hex loopback' },
      { ip: '0:0:0:0:0:ffff:10.0.0.1', desc: 'IPv4-mapped IPv6 expanded format' },
      { ip: '2002:7f00:0001::', desc: '6to4 IPv6 embedding 127.0.0.1' },
      { ip: '64:ff9b::127.0.0.1', desc: 'NAT64 IPv6 embedding 127.0.0.1' }
    ];

    for (const sample of blockedIpv6Samples) {
      it(`blocks restricted IPv6: ${sample.ip} (${sample.desc})`, () => {
        const result = isGloballyRoutableIp(sample.ip);
        expect(result.isValid).toBe(true);
        expect(result.isGloballyRoutable).toBe(false);
        expect(result.reason).toBeTruthy();
      });
    }

    const validPublicIpv6Samples = [
      '2606:2800:220:1:248:1893:25c8:1946', // example.com IPv6
      '2001:4860:4860::8888', // Google DNS IPv6
      '2607:f8b0:4004:800::200e', // Google IPv6
      '2606:4700:4700::1111', // Cloudflare DNS IPv6
      '::ffff:93.184.216.34' // IPv4-mapped public IPv4
    ];

    for (const ip of validPublicIpv6Samples) {
      it(`accepts globally routable public IPv6: ${ip}`, () => {
        const result = isGloballyRoutableIp(ip);
        expect(result.isValid).toBe(true);
        expect(result.isGloballyRoutable).toBe(true);
        expect(result.reason).toBeNull();
      });
    }
  });

  describe('URL & Hostname Validation', () => {
    it('returns NOT_APPLICABLE for empty / null / whitespace input', () => {
      expect(validateTargetUrl(null).error).toBe('NOT_APPLICABLE');
      expect(validateTargetUrl(undefined).error).toBe('NOT_APPLICABLE');
      expect(validateTargetUrl('').error).toBe('NOT_APPLICABLE');
      expect(validateTargetUrl('    ').error).toBe('NOT_APPLICABLE');
    });

    it('rejects unsupported protocols with INVALID_URL', () => {
      expect(validateTargetUrl('file:///etc/passwd').error).toBe('INVALID_URL');
      expect(validateTargetUrl('ftp://example.com').error).toBe('INVALID_URL');
      expect(validateTargetUrl('gopher://example.com').error).toBe('INVALID_URL');
      expect(validateTargetUrl('data:text/html,<h1>hi</h1>').error).toBe('INVALID_URL');
      expect(validateTargetUrl('javascript:alert(1)').error).toBe('INVALID_URL');
      expect(validateTargetUrl('blob:https://example.com/uuid').error).toBe('INVALID_URL');
      expect(validateTargetUrl('ws://example.com').error).toBe('INVALID_URL');
      expect(validateTargetUrl('wss://example.com').error).toBe('INVALID_URL');
    });

    it('rejects URLs with embedded credentials with INVALID_URL', () => {
      const res1 = validateTargetUrl('http://user:pass@example.com');
      expect(res1.isValid).toBe(false);
      expect(res1.error).toBe('INVALID_URL');

      const res2 = validateTargetUrl('https://admin@example.com/path');
      expect(res2.isValid).toBe(false);
      expect(res2.error).toBe('INVALID_URL');
    });

    it('rejects prohibited local / internal hostnames with BLOCKED_SSRF', () => {
      expect(validateTargetUrl('http://localhost').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://localhost:8080').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://api.localhost').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://service.local').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://database.internal').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://router.lan').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://nas.home').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://auth.corp').error).toBe('BLOCKED_SSRF');
    });

    it('rejects direct private IP literals with BLOCKED_SSRF', () => {
      expect(validateTargetUrl('http://127.0.0.1:3000').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://169.254.169.254/latest/meta-data').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://10.0.0.5').error).toBe('BLOCKED_SSRF');
      expect(validateTargetUrl('http://[::1]:8080').error).toBe('BLOCKED_SSRF');
    });

    it('rejects single-label non-TLD hostnames with INVALID_URL', () => {
      expect(validateTargetUrl('http://intranet').error).toBe('INVALID_URL');
      expect(validateTargetUrl('http://myserver').error).toBe('INVALID_URL');
    });

    it('accepts valid public domain names and normalizes scheme', () => {
      const res1 = validateTargetUrl('https://example.com');
      expect(res1.isValid).toBe(true);
      expect(res1.hostname).toBe('example.com');
      expect(res1.isHttps).toBe(true);

      const res2 = validateTargetUrl('http://example.com/about?query=1');
      expect(res2.isValid).toBe(true);
      expect(res2.hostname).toBe('example.com');
      expect(res2.isHttps).toBe(false);

      const res3 = validateTargetUrl('example.com');
      expect(res3.isValid).toBe(true);
      expect(res3.hostname).toBe('example.com');
      expect(res3.isHttps).toBe(true);
    });
  });

  describe('DNS Resolution & Mixed DNS Defense', () => {
    it('returns pinned IP when all returned DNS addresses are globally routable', async () => {
      const mockLookup = async (): Promise<ResolvedAddress[]> => [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
      ];

      const result = await resolveAndValidateHost('example.com', mockLookup);
      expect(result.success).toBe(true);
      expect(result.pinnedIp).toBe('93.184.216.34');
      expect(result.family).toBe(4);
      expect(result.error).toBeNull();
    });

    it('rejects host with BLOCKED_SSRF if ANY returned address is private (Mixed DNS Defense)', async () => {
      const mockMixedLookup = async (): Promise<ResolvedAddress[]> => [
        { address: '93.184.216.34', family: 4 }, // public IP
        { address: '127.0.0.1', family: 4 } // restricted private loopback
      ];

      const result = await resolveAndValidateHost('mixed-dns.example.com', mockMixedLookup);
      expect(result.success).toBe(false);
      expect(result.pinnedIp).toBeNull();
      expect(result.error).toBe('BLOCKED_SSRF');
      expect(result.reason).toContain('DNS returned non-global address (127.0.0.1)');
    });

    it('returns UNREACHABLE when DNS lookup fails (ENOTFOUND / EAI_AGAIN)', async () => {
      const mockFailingLookup = async (): Promise<ResolvedAddress[]> => {
        const err = new Error('getaddrinfo ENOTFOUND non-existent-domain.xyz') as any;
        err.code = 'ENOTFOUND';
        throw err;
      };

      const result = await resolveAndValidateHost('non-existent-domain.xyz', mockFailingLookup);
      expect(result.success).toBe(false);
      expect(result.error).toBe('UNREACHABLE');
      expect(result.reason).toContain('ENOTFOUND');
    });

    it('returns UNREACHABLE when DNS returns 0 addresses', async () => {
      const mockEmptyLookup = async (): Promise<ResolvedAddress[]> => [];

      const result = await resolveAndValidateHost('empty-dns.example.com', mockEmptyLookup);
      expect(result.success).toBe(false);
      expect(result.error).toBe('UNREACHABLE');
      expect(result.reason).toContain('0 addresses');
    });
  });
});
