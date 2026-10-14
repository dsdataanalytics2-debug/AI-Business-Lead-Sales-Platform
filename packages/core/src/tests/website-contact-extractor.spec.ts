import { describe, it, expect } from 'vitest';
import {
  extractContactsFromHtml,
  inspectWebsiteContacts,
  type WebsiteContactExtractionResult
} from '../analysis/website-contact-extractor.js';

describe('Website Contact Extractor & SSRF Guard', () => {
  describe('SSRF Protection', () => {
    const blockedUrls = [
      'http://localhost/admin',
      'http://127.0.0.1:8080',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/internal',
      'http://192.168.1.1/router',
      'http://172.16.0.5/api',
      'http://[::1]/secret',
      'file:///etc/passwd',
      'ftp://example.com/file'
    ];

    for (const url of blockedUrls) {
      it(`blocks SSRF target: ${url}`, async () => {
        const result = await inspectWebsiteContacts(url);
        expect(result.contacts).toHaveLength(0);
        expect(result.evidences).toHaveLength(0);
        expect(result.hasExplicitWhatsApp).toBe(false);
        expect(result.isSsrfBlocked || result.error).toBeTruthy();
      });
    }
  });

  describe('HTML Contact Extraction & Provenance', () => {
    it('extracts emails, tel phones, and Facebook links from HTML', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Acme Lighting BD</title></head>
        <body>
          <h1>Welcome to Acme Lighting</h1>
          <a href="mailto:sales@acmelighting.com">Email Us</a>
          <a href="tel:+8801711122233">Call Now</a>
          <p>Support: support@acmelighting.com</p>
          <a href="https://www.facebook.com/acmelightingbd">Facebook Page</a>
          <a href="/contact-us">Contact Page</a>
        </body>
        </html>
      `;

      const result = extractContactsFromHtml(html, 'https://acmelighting.com');

      // Email checks
      const emails = result.contacts.filter((c) => c.type === 'EMAIL');
      expect(emails.length).toBeGreaterThanOrEqual(1);
      expect(emails.map((e) => e.value)).toContain('sales@acmelighting.com');

      // Phone checks (STRICTLY PHONE, NEVER WHATSAPP)
      const phones = result.contacts.filter((c) => c.type === 'PHONE');
      expect(phones).toHaveLength(1);
      expect(phones[0].value).toBe('+8801711122233');
      expect(phones[0].type).toBe('PHONE');

      // Zero WhatsApp when no wa.me link exists
      const whatsapps = result.contacts.filter((c) => c.type === 'WHATSAPP');
      expect(whatsapps).toHaveLength(0);
      expect(result.hasExplicitWhatsApp).toBe(false);

      // Social and contact links
      const fbLinks = result.contacts.filter((c) => c.type === 'FACEBOOK_PAGE');
      expect(fbLinks).toHaveLength(1);
      expect(fbLinks[0].value).toContain('facebook.com/acmelightingbd');

      const contactPages = result.contacts.filter((c) => c.type === 'CONTACT_PAGE');
      expect(contactPages).toHaveLength(1);
    });

    it('identifies explicit WhatsApp evidence when wa.me links are present', () => {
      const html = `
        <div>
          <p>Order online:</p>
          <a href="https://wa.me/8801819988776?text=Hello">Chat on WhatsApp</a>
          <a href="tel:+8801819988776">Call Us</a>
        </div>
      `;

      const result = extractContactsFromHtml(html, 'https://lightingbd.com');

      expect(result.hasExplicitWhatsApp).toBe(true);

      const whatsapps = result.contacts.filter((c) => c.type === 'WHATSAPP');
      expect(whatsapps).toHaveLength(1);
      expect(whatsapps[0].value).toBe('+8801819988776');
      expect(whatsapps[0].confidence).toBe('VERY_HIGH');

      const waEvidence = result.evidences.filter((e) => e.evidenceType === 'EXPLICIT_WA_ME_LINK');
      expect(waEvidence).toHaveLength(1);

      // Phone is still preserved separately as PHONE
      const phones = result.contacts.filter((c) => c.type === 'PHONE');
      expect(phones).toHaveLength(1);
    });

    it('enforces PHONE != WHATSAPP invariant when website lists phone without WhatsApp link', () => {
      const html = `
        <footer>
          <p>Hotline: +8801912345678</p>
          <a href="mailto:info@store.com.bd">info@store.com.bd</a>
        </footer>
      `;

      const result = extractContactsFromHtml(html, 'https://store.com.bd');

      expect(result.hasExplicitWhatsApp).toBe(false);
      const whatsapps = result.contacts.filter((c) => c.type === 'WHATSAPP');
      expect(whatsapps).toHaveLength(0);

      // Phone exists
      const phones = result.contacts.filter((c) => c.type === 'PHONE');
      expect(phones.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('inspectWebsiteContacts with Mock Custom Fetcher', () => {
    it('executes end-to-end inspection safely using custom fetcher', async () => {
      const mockFetcher = async (url: string) => ({
        status: 200,
        html: `
          <html>
            <body>
              <a href="mailto:contact@dhakalighting.com">Email</a>
              <a href="https://wa.me/8801700112233">WhatsApp Direct</a>
            </body>
          </html>
        `
      });

      const res = await inspectWebsiteContacts('https://dhakalighting.com', {
        customFetcher: mockFetcher
      });

      expect(res.isSsrfBlocked).toBe(false);
      expect(res.contacts.length).toBeGreaterThanOrEqual(2);
      expect(res.hasExplicitWhatsApp).toBe(true);
      expect(res.evidences.some((e) => e.sourceType === 'COMPANY_WEBSITE')).toBe(true);
    });
  });
});
