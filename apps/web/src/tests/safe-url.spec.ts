import { describe, it, expect } from 'vitest';
import { getSafeExternalUrl } from '../lib/safe-url.js';

describe('Safe External URL Utility (Pure Unit Tests)', () => {
  it('1. should safely parse and format valid https URLs', () => {
    const res = getSafeExternalUrl('https://example.com/about');
    expect(res).toEqual({
      href: 'https://example.com/about',
      label: 'example.com/about'
    });
  });

  it('2. should safely parse and format valid http URLs', () => {
    const res = getSafeExternalUrl('http://subdomain.example.com');
    expect(res).toEqual({
      href: 'http://subdomain.example.com/',
      label: 'subdomain.example.com'
    });
  });

  it('3. should auto-prepend https:// to scheme-less domain names and host:port', () => {
    const res1 = getSafeExternalUrl('business-portal.com.bd/contact');
    expect(res1).toEqual({
      href: 'https://business-portal.com.bd/contact',
      label: 'business-portal.com.bd/contact'
    });

    const res2 = getSafeExternalUrl('example.com:8080/x');
    expect(res2).toEqual({
      href: 'https://example.com:8080/x',
      label: 'example.com:8080/x'
    });

    const res3 = getSafeExternalUrl('localhost:3000');
    expect(res3).toEqual({
      href: 'https://localhost:3000/',
      label: 'localhost:3000'
    });
  });

  it('4. should handle uppercase / mixed case http(s) schemes correctly', () => {
    const res1 = getSafeExternalUrl('HTTPS://Example.COM/Path');
    expect(res1).toEqual({
      href: 'https://example.com/Path',
      label: 'example.com/Path'
    });

    const res2 = getSafeExternalUrl('Http://a.com');
    expect(res2).toEqual({
      href: 'http://a.com/',
      label: 'a.com'
    });

    const res3 = getSafeExternalUrl('https://example.com:8443/a?b=1#c');
    expect(res3).toEqual({
      href: 'https://example.com:8443/a?b=1#c',
      label: 'example.com:8443/a'
    });
  });

  it('5. should reject javascript: schemes (lowercase, uppercase, mixed, padded)', () => {
    expect(getSafeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeExternalUrl('   javascript:alert(1)   ')).toBeNull();
    expect(getSafeExternalUrl('JAVASCRIPT:alert(1)')).toBeNull();
    expect(getSafeExternalUrl('JaVaScRiPt:alert(1)')).toBeNull();
  });

  it('6. should reject obfuscated javascript: schemes with tabs or control chars', () => {
    expect(getSafeExternalUrl('java\tscript:alert(1)')).toBeNull();
    expect(getSafeExternalUrl('java\nscript:alert(1)')).toBeNull();
    expect(getSafeExternalUrl('java\rscript:alert(1)')).toBeNull();
  });

  it('7. should reject data:, vbscript:, file:, ftp:, mailto:, tel:, and about: schemes', () => {
    expect(getSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(getSafeExternalUrl('vbscript:msgbox("hello")')).toBeNull();
    expect(getSafeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(getSafeExternalUrl('ftp://ftp.example.com/files')).toBeNull();
    expect(getSafeExternalUrl('blob:https://example.com/uuid')).toBeNull();
    expect(getSafeExternalUrl('mailto:a@b.com')).toBeNull();
    expect(getSafeExternalUrl('tel:+8801711000000')).toBeNull();
    expect(getSafeExternalUrl('about:blank')).toBeNull();
  });

  it('8. should reject URLs containing user credentials / userinfo', () => {
    expect(getSafeExternalUrl('https://admin:secret@malicious.com')).toBeNull();
    expect(getSafeExternalUrl('http://user@domain.com/path')).toBeNull();
    expect(getSafeExternalUrl('https://user:pass@example.com')).toBeNull();
  });

  it('9. should reject protocol-relative URLs (//example.com)', () => {
    expect(getSafeExternalUrl('//malicious.com/attack')).toBeNull();
    expect(getSafeExternalUrl('//example.com')).toBeNull();
  });

  it('10. should safely return null for empty, whitespace, null, or undefined inputs', () => {
    expect(getSafeExternalUrl('')).toBeNull();
    expect(getSafeExternalUrl('   ')).toBeNull();
    expect(getSafeExternalUrl(null)).toBeNull();
    expect(getSafeExternalUrl(undefined)).toBeNull();
  });

  it('11. should reject garbage, internal whitespace, or unparseable URLs', () => {
    expect(getSafeExternalUrl('http://   ')).toBeNull();
    expect(getSafeExternalUrl('https://ex ample.com')).toBeNull();
    expect(getSafeExternalUrl('example.com/a b')).toBeNull();
    expect(getSafeExternalUrl(':::garbage:::')).toBeNull();
  });
});
