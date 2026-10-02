/**
 * SSRF-Safe Website Analyzer & Lightweight HTML Metadata Extractor
 *
 * Implements safe, bounded HTTP website probing:
 * - Scheme enforcement (only http: and https:)
 * - Pre-flight DNS resolution & globally-routable IP classification
 * - Socket IP pinning protecting against DNS rebinding attacks
 * - Strict total wall-clock budget (5000ms across all DNS/TLS/redirects/streaming)
 * - Manual redirect validation (max 3 hops, revalidating every destination IP)
 * - Content-Type validation (text/html, application/xhtml+xml only; non-HTML aborted)
 * - Progressive streaming body cap (max 100 KB / early abort on </head>)
 * - Attribute-order-agnostic <title> and <meta name="description"> extraction
 * - Pure dependency injection for 100% deterministic, zero-network unit testing
 */

import http from 'http';
import https from 'https';
import { AnalysisWebsiteStatus } from '@leadmate/shared';
import {
  validateTargetUrl,
  resolveAndValidateHost,
  type DnsLookupFn,
  type ResolvedTarget
} from './ssrf-guard.js';

export const ANALYZER_VERSION = 'v1';
export const USER_AGENT = 'LeadMateBot/1.0';
export const MAX_BODY_BYTES = 100 * 1024; // 100 KB (102,400 bytes)
export const TOTAL_TIMEOUT_MS = 5000; // 5000ms wall-clock budget
export const MAX_REDIRECTS = 3;

export interface WebsiteAnalysisResult {
  websiteUrl: string | null;
  websiteStatus: AnalysisWebsiteStatus;
  httpStatusCode: number | null;
  isHttps: boolean;
  isRedirected: boolean;
  finalUrl: string | null;
  responseTimeMs: number | null;
  pageTitle: string | null;
  metaDescription: string | null;
}

export type RequestTransportFn = (
  options: http.RequestOptions | https.RequestOptions,
  callback?: (res: http.IncomingMessage) => void
) => http.ClientRequest;

export interface WebsiteAnalyzerDependencies {
  dnsLookup?: DnsLookupFn;
  httpRequest?: RequestTransportFn;
  httpsRequest?: RequestTransportFn;
  now?: () => number;
}

// =========================================================
// HTML Entity & Text Cleaning Utilities
// =========================================================

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        const code = parseInt(dec, 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        const code = parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      } catch {
        return '';
      }
    });
}

export function extractHtmlMetadata(html: string): { pageTitle: string | null; metaDescription: string | null } {
  let pageTitle: string | null = null;
  let metaDescription: string | null = null;

  // 1. Extract <title>...</title>
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    const raw = titleMatch[1]
      .replace(/<[^>]+>/g, ' ') // Strip nested HTML tags
      .replace(/\s+/g, ' '); // Collapse whitespace
    const decoded = decodeHtmlEntities(raw).trim();
    if (decoded.length > 0) {
      pageTitle = decoded.slice(0, 255);
    }
  }

  // 2. Extract <meta name="description" content="..."> with attribute order & quote style independence
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const nameMatch = tag.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const nameVal = nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3]) : null;

    if (nameVal && nameVal.toLowerCase() === 'description') {
      const contentMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const contentVal = contentMatch ? (contentMatch[1] ?? contentMatch[2] ?? contentMatch[3]) : null;

      if (contentVal !== undefined && contentVal !== null) {
        const decoded = decodeHtmlEntities(contentVal.replace(/\s+/g, ' ')).trim();
        if (decoded.length > 0) {
          metaDescription = decoded.slice(0, 500);
          break;
        }
      }
    }
  }

  return { pageTitle, metaDescription };
}

// =========================================================
// Pure Website Analyzer Implementation
// =========================================================

export class WebsiteAnalyzer {
  private readonly dnsLookup?: DnsLookupFn;
  private readonly httpRequest: RequestTransportFn;
  private readonly httpsRequest: RequestTransportFn;
  private readonly now: () => number;

  constructor(dependencies: WebsiteAnalyzerDependencies = {}) {
    this.dnsLookup = dependencies.dnsLookup;
    this.httpRequest = dependencies.httpRequest || http.request;
    this.httpsRequest = dependencies.httpsRequest || https.request;
    this.now = dependencies.now || Date.now;
  }

  /**
   * Performs an SSRF-safe, bounded analysis of a target website URL.
   */
  async analyze(rawUrl?: string | null): Promise<WebsiteAnalysisResult> {
    const startTime = this.now();
    const deadline = startTime + TOTAL_TIMEOUT_MS;

    // 1. Initial URL Validation
    const urlValidation = validateTargetUrl(rawUrl);
    if (!urlValidation.isValid) {
      if (urlValidation.error === 'NOT_APPLICABLE') {
        return {
          websiteUrl: null,
          websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
          httpStatusCode: null,
          isHttps: false,
          isRedirected: false,
          finalUrl: null,
          responseTimeMs: null,
          pageTitle: null,
          metaDescription: null
        };
      }

      if (urlValidation.error === 'BLOCKED_SSRF') {
        return {
          websiteUrl: rawUrl || null,
          websiteStatus: AnalysisWebsiteStatus.BLOCKED_SSRF,
          httpStatusCode: null,
          isHttps: urlValidation.isHttps,
          isRedirected: false,
          finalUrl: null,
          responseTimeMs: null,
          pageTitle: null,
          metaDescription: null
        };
      }

      return {
        websiteUrl: rawUrl || null,
        websiteStatus: AnalysisWebsiteStatus.INVALID_URL,
        httpStatusCode: null,
        isHttps: false,
        isRedirected: false,
        finalUrl: null,
        responseTimeMs: null,
        pageTitle: null,
        metaDescription: null
      };
    }

    let currentUrl = urlValidation.url!;
    const initialUrlString = currentUrl.href;
    let redirectCount = 0;
    const visitedUrls = new Set<string>([initialUrlString]);

    while (true) {
      const now = this.now();
      const remainingTime = deadline - now;
      if (remainingTime <= 0) {
        return {
          websiteUrl: initialUrlString,
          websiteStatus: AnalysisWebsiteStatus.TIMEOUT,
          httpStatusCode: null,
          isHttps: currentUrl.protocol === 'https:',
          isRedirected: redirectCount > 0,
          finalUrl: currentUrl.href,
          responseTimeMs: TOTAL_TIMEOUT_MS,
          pageTitle: null,
          metaDescription: null
        };
      }

      // 2. Pre-flight DNS Resolution & IP Classification
      const resolvedTarget = await resolveAndValidateHost(currentUrl.hostname, this.dnsLookup);

      // Check if DNS resolution consumed remaining budget
      if (this.now() >= deadline) {
        return {
          websiteUrl: initialUrlString,
          websiteStatus: AnalysisWebsiteStatus.TIMEOUT,
          httpStatusCode: null,
          isHttps: currentUrl.protocol === 'https:',
          isRedirected: redirectCount > 0,
          finalUrl: currentUrl.href,
          responseTimeMs: TOTAL_TIMEOUT_MS,
          pageTitle: null,
          metaDescription: null
        };
      }

      if (!resolvedTarget.success) {
        return {
          websiteUrl: initialUrlString,
          websiteStatus:
            resolvedTarget.error === 'BLOCKED_SSRF'
              ? AnalysisWebsiteStatus.BLOCKED_SSRF
              : AnalysisWebsiteStatus.UNREACHABLE,
          httpStatusCode: null,
          isHttps: currentUrl.protocol === 'https:',
          isRedirected: redirectCount > 0,
          finalUrl: currentUrl.href,
          responseTimeMs: Math.max(0, this.now() - startTime),
          pageTitle: null,
          metaDescription: null
        };
      }

      // 3. Execute Single Bounded HTTP Request with Socket Pinning
      const hopRemainingTime = deadline - this.now();
      if (hopRemainingTime <= 0) {
        return {
          websiteUrl: initialUrlString,
          websiteStatus: AnalysisWebsiteStatus.TIMEOUT,
          httpStatusCode: null,
          isHttps: currentUrl.protocol === 'https:',
          isRedirected: redirectCount > 0,
          finalUrl: currentUrl.href,
          responseTimeMs: TOTAL_TIMEOUT_MS,
          pageTitle: null,
          metaDescription: null
        };
      }

      const hopResult = await this.executePinnedRequest(
        currentUrl,
        resolvedTarget,
        hopRemainingTime
      );

      // Check timeout or network error during hop
      if (hopResult.status === 'TIMEOUT' || this.now() >= deadline) {
        return {
          websiteUrl: initialUrlString,
          websiteStatus: AnalysisWebsiteStatus.TIMEOUT,
          httpStatusCode: hopResult.statusCode,
          isHttps: currentUrl.protocol === 'https:',
          isRedirected: redirectCount > 0,
          finalUrl: currentUrl.href,
          responseTimeMs: Math.max(0, this.now() - startTime),
          pageTitle: null,
          metaDescription: null
        };
      }

      if (hopResult.status === 'NETWORK_ERROR') {
        return {
          websiteUrl: initialUrlString,
          websiteStatus: AnalysisWebsiteStatus.UNREACHABLE,
          httpStatusCode: hopResult.statusCode,
          isHttps: currentUrl.protocol === 'https:',
          isRedirected: redirectCount > 0,
          finalUrl: currentUrl.href,
          responseTimeMs: Math.max(0, this.now() - startTime),
          pageTitle: null,
          metaDescription: null
        };
      }

      const statusCode = hopResult.statusCode;

      // 4. Handle Redirects (301, 302, 303, 307, 308)
      if (
        statusCode &&
        [301, 302, 303, 307, 308].includes(statusCode) &&
        hopResult.locationHeader
      ) {
        redirectCount += 1;
        if (redirectCount > MAX_REDIRECTS) {
          return {
            websiteUrl: initialUrlString,
            websiteStatus: AnalysisWebsiteStatus.UNREACHABLE,
            httpStatusCode: statusCode,
            isHttps: currentUrl.protocol === 'https:',
            isRedirected: true,
            finalUrl: currentUrl.href,
            responseTimeMs: Math.max(0, this.now() - startTime),
            pageTitle: null,
            metaDescription: null
          };
        }

        // Resolve next target URL relative to current URL
        let nextUrl: URL;
        try {
          nextUrl = new URL(hopResult.locationHeader, currentUrl.href);
        } catch {
          return {
            websiteUrl: initialUrlString,
            websiteStatus: AnalysisWebsiteStatus.UNREACHABLE,
            httpStatusCode: statusCode,
            isHttps: currentUrl.protocol === 'https:',
            isRedirected: true,
            finalUrl: currentUrl.href,
            responseTimeMs: Math.max(0, this.now() - startTime),
            pageTitle: null,
            metaDescription: null
          };
        }

        // Loop detection
        if (visitedUrls.has(nextUrl.href)) {
          return {
            websiteUrl: initialUrlString,
            websiteStatus: AnalysisWebsiteStatus.UNREACHABLE,
            httpStatusCode: statusCode,
            isHttps: currentUrl.protocol === 'https:',
            isRedirected: true,
            finalUrl: currentUrl.href,
            responseTimeMs: Math.max(0, this.now() - startTime),
            pageTitle: null,
            metaDescription: null
          };
        }
        visitedUrls.add(nextUrl.href);

        // Validate redirect target scheme & hostname
        const nextUrlValidation = validateTargetUrl(nextUrl.href);
        if (!nextUrlValidation.isValid) {
          return {
            websiteUrl: initialUrlString,
            websiteStatus:
              nextUrlValidation.error === 'BLOCKED_SSRF'
                ? AnalysisWebsiteStatus.BLOCKED_SSRF
                : AnalysisWebsiteStatus.INVALID_URL,
            httpStatusCode: statusCode,
            isHttps: nextUrl.protocol === 'https:',
            isRedirected: true,
            finalUrl: nextUrl.href,
            responseTimeMs: Math.max(0, this.now() - startTime),
            pageTitle: null,
            metaDescription: null
          };
        }

        currentUrl = nextUrlValidation.url!;
        continue;
      }

      // 5. Handle Terminal Response Status
      const responseTimeMs = Math.max(0, this.now() - startTime);
      const isHttps = currentUrl.protocol === 'https:';
      const isRedirected = redirectCount > 0;
      const finalUrl = currentUrl.href;

      // Access restriction checks (401, 403, 429)
      if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
        return {
          websiteUrl: initialUrlString,
          websiteStatus: AnalysisWebsiteStatus.ACCESS_RESTRICTED,
          httpStatusCode: statusCode,
          isHttps,
          isRedirected,
          finalUrl,
          responseTimeMs,
          pageTitle: null,
          metaDescription: null
        };
      }

      // Dead link / server error (404, 410, 5xx, or other 4xx)
      if (statusCode && statusCode >= 400) {
        return {
          websiteUrl: initialUrlString,
          websiteStatus: AnalysisWebsiteStatus.UNREACHABLE,
          httpStatusCode: statusCode,
          isHttps,
          isRedirected,
          finalUrl,
          responseTimeMs,
          pageTitle: null,
          metaDescription: null
        };
      }

      // Content-Type Check: only text/html and application/xhtml+xml allowed
      if (!hopResult.isHtml) {
        return {
          websiteUrl: initialUrlString,
          websiteStatus: AnalysisWebsiteStatus.NON_HTML,
          httpStatusCode: statusCode,
          isHttps,
          isRedirected,
          finalUrl,
          responseTimeMs,
          pageTitle: null,
          metaDescription: null
        };
      }

      // 6. Extract Metadata on REACHABLE 2xx page
      const { pageTitle, metaDescription } = extractHtmlMetadata(hopResult.body);

      return {
        websiteUrl: initialUrlString,
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: statusCode,
        isHttps,
        isRedirected,
        finalUrl,
        responseTimeMs,
        pageTitle,
        metaDescription
      };
    }
  }

  /**
   * Executes a single pinned HTTP/HTTPS request, streaming up to MAX_BODY_BYTES.
   */
  private executePinnedRequest(
    targetUrl: URL,
    resolved: ResolvedTarget,
    timeoutMs: number
  ): Promise<{
    status: 'SUCCESS' | 'TIMEOUT' | 'NETWORK_ERROR';
    statusCode: number | null;
    locationHeader: string | null;
    isHtml: boolean;
    body: string;
  }> {
    return new Promise((resolve) => {
      const isHttps = targetUrl.protocol === 'https:';
      const transport = isHttps ? this.httpsRequest : this.httpRequest;

      const port = targetUrl.port
        ? Number(targetUrl.port)
        : isHttps
        ? 443
        : 80;

      const requestOptions: http.RequestOptions | https.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port,
        path: targetUrl.pathname + targetUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          Host: targetUrl.host
        },
        // Pin DNS lookup to the pre-validated IP directly
        lookup: ((_hostname: string, _opts: any, cb: any) => {
          cb(null, resolved.pinnedIp, resolved.family);
        }) as any,
        servername: targetUrl.hostname, // Preserves TLS SNI
        rejectUnauthorized: true // Strict TLS verification
      };

      let isFinished = false;
      const finish = (result: any) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        try {
          req.destroy(new Error('TIMEOUT'));
        } catch {}
        finish({
          status: 'TIMEOUT',
          statusCode: null,
          locationHeader: null,
          isHtml: false,
          body: ''
        });
      }, timeoutMs);

      let req: http.ClientRequest;
      try {
        req = transport(requestOptions, (res: http.IncomingMessage) => {
          const statusCode = res.statusCode || null;
          const locationHeader = (res.headers['location'] as string) || null;
          const contentType = ((res.headers['content-type'] as string) || '').toLowerCase();
          const isHtml =
            contentType.includes('text/html') ||
            contentType.includes('application/xhtml+xml');

          // If redirect or error status or non-HTML, we do not need body
          const isRedirect = statusCode && [301, 302, 303, 307, 308].includes(statusCode);
          if (isRedirect || (statusCode && statusCode >= 400) || !isHtml) {
            res.resume(); // Discard stream
            finish({
              status: 'SUCCESS',
              statusCode,
              locationHeader,
              isHtml,
              body: ''
            });
            return;
          }

          let body = '';
          let bytesRead = 0;

          res.on('data', (chunk: Buffer | string) => {
            const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            bytesRead += Buffer.byteLength(chunk);
            body += str;

            // Early abort if </head> or <body encountered or byte budget exhausted
            if (/(<\/head>|<body\b)/i.test(body) || bytesRead >= MAX_BODY_BYTES) {
              res.destroy(); // Stop receiving data
              finish({
                status: 'SUCCESS',
                statusCode,
                locationHeader,
                isHtml,
                body
              });
            }
          });

          res.on('end', () => {
            finish({
              status: 'SUCCESS',
              statusCode,
              locationHeader,
              isHtml,
              body
            });
          });

          res.on('error', () => {
            finish({
              status: 'NETWORK_ERROR',
              statusCode,
              locationHeader,
              isHtml,
              body
            });
          });
        });

        req.on('error', (err: any) => {
          if (err?.message === 'TIMEOUT') {
            finish({
              status: 'TIMEOUT',
              statusCode: null,
              locationHeader: null,
              isHtml: false,
              body: ''
            });
          } else {
            finish({
              status: 'NETWORK_ERROR',
              statusCode: null,
              locationHeader: null,
              isHtml: false,
              body: ''
            });
          }
        });

        req.end();
      } catch {
        finish({
          status: 'NETWORK_ERROR',
          statusCode: null,
          locationHeader: null,
          isHtml: false,
          body: ''
        });
      }
    });
  }
}

export const websiteAnalyzer = new WebsiteAnalyzer();
