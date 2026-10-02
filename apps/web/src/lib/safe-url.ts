/**
 * Safe external URL parser and validator
 *
 * Enforces strict security constraints:
 * - Reject control characters and whitespace within URLs
 * - Reject non-http(s) schemes (javascript, data, vbscript, file, blob, ftp, mailto, tel, about, etc.)
 * - Reject scheme obfuscation (e.g. java\tscript:)
 * - Reject URLs with userinfo credentials (user:pass@)
 * - Auto-prepend https:// to scheme-less inputs (including host:port like localhost:3000 or example.com:8080)
 * - Return { href, label } for valid http/https URLs or null on any validation failure
 */

const CONTROL_OR_WHITESPACE_PATTERN = /[\x00-\x1F\x7F\s]/;
const GENERIC_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT_PATTERN = /^[^\/\s:]+:\d+(\/|$)/;
const HTTP_HTTPS_PATTERN = /^https?:\/\//i;

export function getSafeExternalUrl(url?: string | null): { href: string; label: string } | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Reject internal control characters and spaces
  if (CONTROL_OR_WHITESPACE_PATTERN.test(trimmed)) {
    return null;
  }

  // Reject explicit protocol-relative URLs (e.g. //example.com)
  if (trimmed.startsWith('//')) {
    return null;
  }

  // Reject non-http(s) explicit schemes while preserving scheme-less host:port (e.g. localhost:3000)
  if (
    GENERIC_SCHEME_PATTERN.test(trimmed) &&
    !HOST_PORT_PATTERN.test(trimmed) &&
    !HTTP_HTTPS_PATTERN.test(trimmed)
  ) {
    return null;
  }

  try {
    const formatted = HTTP_HTTPS_PATTERN.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    const parsed = new URL(formatted);

    // Strictly enforce http: or https:
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // Reject user credentials (e.g. https://user:pass@domain.com)
    if (parsed.username || parsed.password) {
      return null;
    }

    // Ensure valid non-empty hostname
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return null;
    }

    // Label: host (includes hostname and port if present) + pathname (if not '/')
    const labelPath = parsed.pathname !== '/' ? parsed.pathname : '';
    const label = `${parsed.host}${labelPath}`;

    return {
      href: parsed.href,
      label
    };
  } catch {
    return null;
  }
}
