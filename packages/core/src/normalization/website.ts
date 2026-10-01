/**
 * Website and Domain Normalization Utility
 *
 * Implements deterministic website domain extraction and normalization
 * for business identity and duplicate candidate matching.
 *
 * ACCEPTED FORMS:
 * - Bare domains: example.com, www.example.com
 * - Full HTTP/HTTPS URLs: https://www.example.com/path?q=1#test, HTTPS://WWW.Example.COM/path
 *
 * EXPLICITLY REJECTED:
 * - localhost, 127.0.0.1
 * - hello world, example (single-label without valid TLD)
 * - http://, ://example.com
 * - javascript:alert(1), mailto:test@example.com, ftp://example.com
 * - Malformed URLs or arbitrary non-domain text
 */

export interface WebsiteNormalizationResult {
  rawValue: string;
  normalizedDomain: string | null;
  normalizedUrl: string | null;
  isValid: boolean;
  error: string | null;
}

// Domain validation regex: valid dot-separated labels, valid 2-63 char alpha TLD
const STRICT_DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

// Regex detecting any URI scheme (e.g. http:, https:, javascript:, mailto:, ftp:)
const SCHEME_REGEX = /^([a-zA-Z][a-zA-Z0-9+.-]*):(\/\/)?/;

/**
 * Normalizes a website URL and extracts its comparison domain.
 *
 * @param input - Raw URL string (e.g. 'https://www.Example.COM/path?q=1', 'example.com')
 * @returns Structured website normalization result
 *
 * @example
 * normalizeWebsite('example.com') // normalizedDomain: 'example.com', isValid: true
 * normalizeWebsite('www.example.com') // normalizedDomain: 'example.com', isValid: true
 * normalizeWebsite('https://www.example.com/path?q=1#test') // normalizedDomain: 'example.com', isValid: true
 * normalizeWebsite('HTTPS://WWW.Example.COM/path') // normalizedDomain: 'example.com', isValid: true
 */
export function normalizeWebsite(input: string): WebsiteNormalizationResult {
  const rawValue = typeof input === 'string' ? input : '';
  const trimmed = rawValue.trim();

  // 1. Check for empty string or internal whitespace (e.g. "hello world")
  if (!trimmed) {
    return {
      rawValue,
      normalizedDomain: null,
      normalizedUrl: null,
      isValid: false,
      error: 'Empty website URL'
    };
  }

  if (/\s/.test(trimmed)) {
    return {
      rawValue,
      normalizedDomain: null,
      normalizedUrl: null,
      isValid: false,
      error: 'Website URL contains whitespace'
    };
  }

  // 2. Reject leading colon-slashes like "://example.com"
  if (trimmed.startsWith('://') || trimmed.startsWith(':')) {
    return {
      rawValue,
      normalizedDomain: null,
      normalizedUrl: null,
      isValid: false,
      error: 'Malformed URL scheme'
    };
  }

  // 3. Inspect scheme if present
  const schemeMatch = trimmed.match(SCHEME_REGEX);
  let urlToParse = trimmed;

  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    // Strictly accept only http and https
    if (scheme !== 'http' && scheme !== 'https') {
      return {
        rawValue,
        normalizedDomain: null,
        normalizedUrl: null,
        isValid: false,
        error: `Unsupported protocol: "${scheme}:"`
      };
    }

    // Reject incomplete scheme like "http://" or "https://" without host
    const afterScheme = trimmed.slice(schemeMatch[0].length);
    if (!afterScheme || afterScheme === '/') {
      return {
        rawValue,
        normalizedDomain: null,
        normalizedUrl: null,
        isValid: false,
        error: 'Missing host in URL'
      };
    }
  } else {
    // Bare domain input (e.g. "example.com", "www.example.com/path")
    // Prepend https:// for parsing
    urlToParse = 'https://' + trimmed;
  }

  // 4. Parse with URL constructor
  let parsed: URL;
  try {
    parsed = new URL(urlToParse);
  } catch {
    return {
      rawValue,
      normalizedDomain: null,
      normalizedUrl: null,
      isValid: false,
      error: 'Malformed website URL'
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 5. Explicitly reject localhost, loopback / IPv4, single-label domains ("example"), or malformed hosts
  if (
    hostname === 'localhost' ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    !hostname.includes('.') ||
    !STRICT_DOMAIN_REGEX.test(hostname)
  ) {
    return {
      rawValue,
      normalizedDomain: null,
      normalizedUrl: null,
      isValid: false,
      error: `Invalid domain name format: "${hostname}"`
    };
  }

  // 6. Strip leading 'www.' for stable candidate domain matching
  const normalizedDomain = hostname.replace(/^www\./i, '');
  const normalizedUrl = `https://${normalizedDomain}`;

  return {
    rawValue,
    normalizedDomain,
    normalizedUrl,
    isValid: true,
    error: null
  };
}
