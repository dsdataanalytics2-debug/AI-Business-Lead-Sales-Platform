import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import http from 'http';
import https from 'https';
import { AnalysisWebsiteStatus } from '@leadmate/shared';
import {
  WebsiteAnalyzer,
  decodeHtmlEntities,
  extractHtmlMetadata,
  MAX_BODY_BYTES,
  type RequestTransportFn
} from '../analysis/website-analyzer.js';
import type { DnsLookupFn } from '../analysis/ssrf-guard.js';

interface MockResponseConfig {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
  emitError?: boolean;
}

function createMockTransport(
  handler: (options: http.RequestOptions) => MockResponseConfig | Promise<MockResponseConfig>,
  onCall?: (options: http.RequestOptions) => void
): RequestTransportFn {
  return (options: http.RequestOptions, callback?: (res: http.IncomingMessage) => void): http.ClientRequest => {
    if (onCall) onCall(options);

    const req = new EventEmitter() as any;
    req.destroy = vi.fn((_err?: any) => {
      req.emit('error', new Error('TIMEOUT'));
    });
    req.end = vi.fn(async () => {
      try {
        const config = await Promise.resolve(handler(options));

        if (config.emitError) {
          req.emit('error', new Error('Connection refused'));
          return;
        }

        const res = new Readable({
          read() {}
        }) as any;
        res.statusCode = config.statusCode;
        res.headers = {
          'content-type': 'text/html; charset=utf-8',
          ...(config.headers || {})
        };

        if (callback) {
          callback(res);
        }

        if (config.body) {
          res.push(Buffer.from(config.body, 'utf8'));
        }
        res.push(null); // EOF
      } catch (err: any) {
        req.emit('error', err);
      }
    });

    return req;
  };
}

describe('Website Analyzer & HTML Metadata Extractor', () => {
  describe('HTML Entity & Metadata Utilities', () => {
    it('decodes common HTML entities and unicode numeric entities', () => {
      expect(decodeHtmlEntities('&amp; &lt; &gt; &quot; &#39; &apos; &nbsp; &ndash; &mdash;'))
        .toBe('& < > " \' \'   – —');
      expect(decodeHtmlEntities('&#65;&#66;&#67;')).toBe('ABC');
      expect(decodeHtmlEntities('&#x41;&#x42;&#x43;')).toBe('ABC');
      expect(decodeHtmlEntities('Bangla: &#2476;&#2494;&#2434;&#2482;&#2494;')).toBe('Bangla: বাংলা');
    });

    it('extracts <title> with whitespace collapsing and nested markup stripping', () => {
      const html = '<html><head><title>  LeadMate   <b>AI</b> &amp; Sales  </title></head></html>';
      const meta = extractHtmlMetadata(html);
      expect(meta.pageTitle).toBe('LeadMate AI & Sales');
    });

    it('handles uppercase <TITLE> and limits title to 255 chars', () => {
      const longTitle = 'A'.repeat(300);
      const html = `<TITLE>${longTitle}</TITLE>`;
      const meta = extractHtmlMetadata(html);
      expect(meta.pageTitle?.length).toBe(255);
      expect(meta.pageTitle).toBe('A'.repeat(255));
    });

    it('returns null for empty or whitespace-only <title>', () => {
      expect(extractHtmlMetadata('<title></title>').pageTitle).toBeNull();
      expect(extractHtmlMetadata('<title>    </title>').pageTitle).toBeNull();
      expect(extractHtmlMetadata('<title><span>  </span></title>').pageTitle).toBeNull();
    });

    it('extracts meta description with name before content', () => {
      const html = '<meta name="description" content="Official website of LeadMate Bangladesh.">';
      const meta = extractHtmlMetadata(html);
      expect(meta.metaDescription).toBe('Official website of LeadMate Bangladesh.');
    });

    it('extracts meta description with content before name and single quotes', () => {
      const html = "<meta content='The fastest CRM in Asia.' name='DESCRIPTION'>";
      const meta = extractHtmlMetadata(html);
      expect(meta.metaDescription).toBe('The fastest CRM in Asia.');
    });

    it('extracts meta description with extra attributes and inner quotes without truncation', () => {
      const html = `<meta id="meta-desc" name="description" class="seo-tag" content="We're Bangladesh's &quot;Top&quot; platform.">`;
      const meta = extractHtmlMetadata(html);
      expect(meta.metaDescription).toBe('We\'re Bangladesh\'s "Top" platform.');
    });

    it('truncates meta description to 500 chars and converts whitespace-only to null', () => {
      const longDesc = 'B'.repeat(600);
      const html1 = `<meta name="description" content="${longDesc}">`;
      expect(extractHtmlMetadata(html1).metaDescription?.length).toBe(500);

      const html2 = '<meta name="description" content="    ">';
      expect(extractHtmlMetadata(html2).metaDescription).toBeNull();
    });
  });

  describe('No-Website & Invalid URL Handling', () => {
    it('returns NOT_APPLICABLE for null, undefined, empty, and whitespace input with 0 network calls', async () => {
      let dnsCalls = 0;
      let httpCalls = 0;

      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => {
          dnsCalls++;
          return [{ address: '93.184.216.34', family: 4 }];
        },
        httpRequest: createMockTransport(() => {
          httpCalls++;
          return { statusCode: 200 };
        })
      });

      for (const input of [null, undefined, '', '   ']) {
        const result = await analyzer.analyze(input);
        expect(result.websiteStatus).toBe(AnalysisWebsiteStatus.NOT_APPLICABLE);
        expect(result.websiteUrl).toBeNull();
        expect(result.httpStatusCode).toBeNull();
        expect(result.responseTimeMs).toBeNull();
      }

      expect(dnsCalls).toBe(0);
      expect(httpCalls).toBe(0);
    });

    it('returns INVALID_URL for unsupported schemes or embedded credentials with 0 transport calls', async () => {
      let httpCalls = 0;
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpRequest: createMockTransport(() => {
          httpCalls++;
          return { statusCode: 200 };
        })
      });

      const res1 = await analyzer.analyze('file:///etc/passwd');
      expect(res1.websiteStatus).toBe(AnalysisWebsiteStatus.INVALID_URL);

      const res2 = await analyzer.analyze('http://user:pass@example.com');
      expect(res2.websiteStatus).toBe(AnalysisWebsiteStatus.INVALID_URL);

      const res3 = await analyzer.analyze('javascript:alert(1)');
      expect(res3.websiteStatus).toBe(AnalysisWebsiteStatus.INVALID_URL);

      expect(httpCalls).toBe(0);
    });

    it('returns BLOCKED_SSRF directly for localhost / private IP hostnames before DNS', async () => {
      let dnsCalls = 0;
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => {
          dnsCalls++;
          return [{ address: '127.0.0.1', family: 4 }];
        }
      });

      const res1 = await analyzer.analyze('http://localhost:3000');
      expect(res1.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);

      const res2 = await analyzer.analyze('http://127.0.0.1');
      expect(res2.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);

      const res3 = await analyzer.analyze('http://169.254.169.254/latest/meta-data');
      expect(res3.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);

      expect(dnsCalls).toBe(0);
    });
  });

  describe('DNS Resolution & Mixed DNS Defense in Analyzer', () => {
    it('rejects target when DNS returns mixed public and private IP with 0 HTTP requests', async () => {
      let httpCalls = 0;
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 }
        ],
        httpRequest: createMockTransport(() => {
          httpCalls++;
          return { statusCode: 200 };
        })
      });

      const res = await analyzer.analyze('http://mixed-dns.example.com');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);
      expect(httpCalls).toBe(0);
    });

    it('returns UNREACHABLE when DNS lookup fails with 0 HTTP requests', async () => {
      let httpCalls = 0;
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => {
          const err = new Error('ENOTFOUND') as any;
          err.code = 'ENOTFOUND';
          throw err;
        },
        httpRequest: createMockTransport(() => {
          httpCalls++;
          return { statusCode: 200 };
        })
      });

      const res = await analyzer.analyze('http://non-existent-domain.xyz');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.UNREACHABLE);
      expect(httpCalls).toBe(0);
    });
  });

  describe('DNS Rebinding & Socket Pinning Verification', () => {
    it('passes custom lookup callback with pinned IP and preserves Host / SNI headers', async () => {
      const capturedOptions: Array<http.RequestOptions & https.RequestOptions> = [];
      const pinnedIp = '93.184.216.34';

      const mockDns: DnsLookupFn = async (hostname) => {
        expect(hostname).toBe('example.com');
        return [{ address: pinnedIp, family: 4 }];
      };

      const mockHttp = createMockTransport(
        () => ({
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: '<html><head><title>Example Domain</title></head></html>'
        }),
        (options) => {
          capturedOptions.push(options as http.RequestOptions & https.RequestOptions);
        }
      );

      const analyzer = new WebsiteAnalyzer({
        dnsLookup: mockDns,
        httpRequest: mockHttp,
        httpsRequest: mockHttp
      });

      const result = await analyzer.analyze('https://example.com/test');

      expect(result.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(result.pageTitle).toBe('Example Domain');
      expect(capturedOptions.length).toBe(1);

      const opts = capturedOptions[0];
      const headers = opts.headers as Record<string, any>;
      expect(opts.hostname).toBe('example.com');
      expect(opts.servername).toBe('example.com'); // SNI preserved
      expect(headers?.Host || headers?.host).toBe('example.com'); // Host header preserved
      expect(headers?.['User-Agent']).toBe('LeadMateBot/1.0');
      expect(opts.rejectUnauthorized).toBe(true);

      // Verify custom lookup callback passes pinned IP
      expect(typeof opts.lookup).toBe('function');
      let cbResultIp: string | null = null;
      let cbResultFamily: number | null = null;
      (opts.lookup as any)('example.com', {}, (_err: any, address: string, family: number) => {
        cbResultIp = address;
        cbResultFamily = family;
      });
      expect(cbResultIp).toBe(pinnedIp);
      expect(cbResultFamily).toBe(4);
    });
  });

  describe('HTTP Status Code Semantics', () => {
    const statuses = [
      { code: 200, expected: AnalysisWebsiteStatus.REACHABLE, html: true },
      { code: 201, expected: AnalysisWebsiteStatus.REACHABLE, html: true },
      { code: 401, expected: AnalysisWebsiteStatus.ACCESS_RESTRICTED, html: true },
      { code: 403, expected: AnalysisWebsiteStatus.ACCESS_RESTRICTED, html: true },
      { code: 429, expected: AnalysisWebsiteStatus.ACCESS_RESTRICTED, html: true },
      { code: 404, expected: AnalysisWebsiteStatus.UNREACHABLE, html: true },
      { code: 410, expected: AnalysisWebsiteStatus.UNREACHABLE, html: true },
      { code: 500, expected: AnalysisWebsiteStatus.UNREACHABLE, html: true },
      { code: 502, expected: AnalysisWebsiteStatus.UNREACHABLE, html: true },
      { code: 503, expected: AnalysisWebsiteStatus.UNREACHABLE, html: true }
    ];

    for (const testCase of statuses) {
      it(`maps HTTP ${testCase.code} to ${testCase.expected}`, async () => {
        const analyzer = new WebsiteAnalyzer({
          dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
          httpsRequest: createMockTransport(() => ({
            statusCode: testCase.code,
            headers: { 'content-type': 'text/html' },
            body: '<html><head><title>Status Page</title></head></html>'
          }))
        });

        const res = await analyzer.analyze('https://example.com/status');
        expect(res.websiteStatus).toBe(testCase.expected);
        expect(res.httpStatusCode).toBe(testCase.code);
      });
    }
  });

  describe('Content-Type Handling', () => {
    it('returns NON_HTML for binary / non-HTML content types without reading large bodies', async () => {
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest: createMockTransport(() => ({
          statusCode: 200,
          headers: { 'content-type': 'application/pdf' },
          body: '%PDF-1.4 ... binary data ...'
        }))
      });

      const res = await analyzer.analyze('https://example.com/doc.pdf');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.NON_HTML);
      expect(res.httpStatusCode).toBe(200);
      expect(res.pageTitle).toBeNull();
    });

    it('accepts application/xhtml+xml and text/html with charset parameters', async () => {
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest: createMockTransport(() => ({
          statusCode: 200,
          headers: { 'content-type': 'application/xhtml+xml; charset=iso-8859-1' },
          body: '<html><head><title>XHTML Page</title></head></html>'
        }))
      });

      const res = await analyzer.analyze('https://example.com/page.xhtml');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(res.pageTitle).toBe('XHTML Page');
    });
  });

  describe('Redirects & Redirect SSRF Defense', () => {
    it('follows valid public redirects (including relative URLs) up to 3 hops and updates flags', async () => {
      let callCount = 0;
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async (host) => {
          if (host === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
          if (host === 'target.com') return [{ address: '104.26.10.228', family: 4 }];
          return [{ address: '93.184.216.34', family: 4 }];
        },
        httpRequest: createMockTransport((opts) => {
          callCount++;
          if (opts.path === '/') {
            return {
              statusCode: 301,
              headers: { location: '/relative-about' }
            };
          }
          if (opts.path === '/relative-about') {
            return {
              statusCode: 302,
              headers: { location: 'https://target.com/final' }
            };
          }
          return { statusCode: 200 };
        }),
        httpsRequest: createMockTransport(() => {
          callCount++;
          return {
            statusCode: 200,
            body: '<html><head><title>Final Target</title></head></html>'
          };
        })
      });

      const res = await analyzer.analyze('http://example.com');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(res.isRedirected).toBe(true);
      expect(res.isHttps).toBe(true);
      expect(res.finalUrl).toBe('https://target.com/final');
      expect(res.pageTitle).toBe('Final Target');
      expect(callCount).toBe(3);
    });

    it('blocks redirect to private IP / localhost (Redirect SSRF) without executing second request', async () => {
      let secondRequestExecuted = false;

      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async (host) => {
          if (host === 'evil-redirect.com') return [{ address: '93.184.216.34', family: 4 }];
          return [{ address: '127.0.0.1', family: 4 }];
        },
        httpRequest: createMockTransport((opts) => {
          if (opts.hostname === 'evil-redirect.com') {
            return {
              statusCode: 302,
              headers: { location: 'http://127.0.0.1:8080/admin' }
            };
          }
          secondRequestExecuted = true;
          return { statusCode: 200 };
        })
      });

      const res = await analyzer.analyze('http://evil-redirect.com');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);
      expect(secondRequestExecuted).toBe(false);
    });

    it('terminates safely as UNREACHABLE on redirect loop (A -> B -> A)', async () => {
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpRequest: createMockTransport((opts) => {
          if (opts.path === '/a') {
            return { statusCode: 302, headers: { location: 'http://example.com/b' } };
          }
          return { statusCode: 302, headers: { location: 'http://example.com/a' } };
        })
      });

      const res = await analyzer.analyze('http://example.com/a');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.UNREACHABLE);
      expect(res.isRedirected).toBe(true);
    });

    it('terminates safely as UNREACHABLE when redirect hops exceed 3', async () => {
      let hop = 0;
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpRequest: createMockTransport(() => {
          hop++;
          return {
            statusCode: 302,
            headers: { location: `http://example.com/hop${hop}` }
          };
        })
      });

      const res = await analyzer.analyze('http://example.com/hop0');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.UNREACHABLE);
      expect(res.isRedirected).toBe(true);
      expect(hop).toBe(4); // initial + 3 redirects = 4 requests attempted
    });
  });

  describe('Total Wall-Clock Timeout Budget', () => {
    it('returns TIMEOUT when total wall-clock budget across multi-hop requests is exhausted', async () => {
      let simulatedTime = 1000;
      const mockNow = () => simulatedTime;

      const analyzer = new WebsiteAnalyzer({
        now: mockNow,
        dnsLookup: async () => {
          simulatedTime += 100;
          return [{ address: '93.184.216.34', family: 4 }];
        },
        httpRequest: createMockTransport(() => {
          // Advance time by 4500ms on first redirect hop, then second hop exceeds 5000ms deadline
          simulatedTime += 4500;
          return {
            statusCode: 302,
            headers: { location: 'http://example.com/step2' }
          };
        })
      });

      const res = await analyzer.analyze('http://example.com/step1');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.TIMEOUT);
    });

    it('returns TIMEOUT when DNS resolution itself exceeds 5000ms deadline', async () => {
      let simulatedTime = 1000;
      const analyzer = new WebsiteAnalyzer({
        now: () => simulatedTime,
        dnsLookup: async () => {
          simulatedTime += 5001; // exceeds 5000ms total budget
          return [{ address: '93.184.216.34', family: 4 }];
        }
      });

      const res = await analyzer.analyze('http://slow-dns.example.com');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.TIMEOUT);
    });
  });

  describe('Result Immutability & Determinism', () => {
    it('produces equivalent deterministic results for identical mocked responses', async () => {
      const createAnalyzer = () =>
        new WebsiteAnalyzer({
          now: () => 1000,
          dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
          httpsRequest: createMockTransport(() => ({
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            body: '<html><head><title>Deterministic</title><meta name="description" content="Stable"></head></html>'
          }))
        });

      const res1 = await createAnalyzer().analyze('https://example.com');
      const res2 = await createAnalyzer().analyze('https://example.com');

      expect(res1).toEqual(res2);
      expect(res1.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(res1.pageTitle).toBe('Deterministic');
      expect(res1.metaDescription).toBe('Stable');
    });
  });
});
