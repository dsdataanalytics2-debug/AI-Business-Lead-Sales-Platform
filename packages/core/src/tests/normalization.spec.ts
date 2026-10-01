import { describe, it, expect } from 'vitest';
import {
  normalizeBengaliDigits,
  normalizePhone,
  normalizeEmail,
  normalizeWebsite,
  normalizeContact
} from '../index.js';
import {
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus
} from '@leadmate/shared';

describe('M1 Step 3: Bengali Digit Normalization', () => {
  it('converts purely Bengali digits to ASCII numerals', () => {
    expect(normalizeBengaliDigits('০১৭১২৩৪৫৬৭৮')).toBe('01712345678');
    expect(normalizeBengaliDigits('০১২৩৪৫৬৭৮৯')).toBe('0123456789');
  });

  it('converts mixed Bengali and ASCII digits', () => {
    expect(normalizeBengaliDigits('০১৭১234৫৬78')).toBe('01712345678');
  });

  it('preserves non-digit and formatting characters untouched', () => {
    expect(normalizeBengaliDigits('+৮৮০ ১৭১২-৩৪৫৬৭৮')).toBe('+880 1712-345678');
    expect(normalizeBengaliDigits('ফোন: ০১৭-১২৩৪৫৬৭৮ (হোয়াটসঅ্যাপ)')).toBe('ফোন: 017-12345678 (হোয়াটসঅ্যাপ)');
  });

  it('handles empty or non-string inputs safely', () => {
    expect(normalizeBengaliDigits('')).toBe('');
    expect(normalizeBengaliDigits(null as unknown as string)).toBe('');
  });
});

describe('M1 Step 3: Bangladesh Phone Normalization', () => {
  it('1. Accepts standard local ASCII BD mobile (01712345678)', () => {
    const res = normalizePhone('01712345678');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.displayValue).toBe('01712345678');
    expect(res.phoneType).toBe(PhoneType.MOBILE);
    expect(res.status).toBe(ContactStatus.FOUND);
    expect(res.countryCode).toBe('BD');
    expect(res.operatorPrefix).toBe('017');
    expect(res.error).toBeNull();
  });

  it('2. Accepts +880 mobile representation (+8801712345678)', () => {
    const res = normalizePhone('+8801712345678');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.displayValue).toBe('01712345678');
  });

  it('3. Accepts 880 mobile representation (8801712345678)', () => {
    const res = normalizePhone('8801712345678');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.displayValue).toBe('01712345678');
  });

  it('4. Explicitly REJECTS 00880... prefix format', () => {
    const res = normalizePhone('008801712345678');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.displayValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
    expect(res.error).toContain('00880');
  });

  it('5. Accepts Bengali digits mobile (০১৭১২৩৪৫৬৭৮)', () => {
    const res = normalizePhone('০১৭১২৩৪৫৬৭৮');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.displayValue).toBe('01712345678');
  });

  it('6. Accepts Bengali +880 representation (+৮৮০১৭১২৩৪৫৬৭৮)', () => {
    const res = normalizePhone('+৮৮০১৭১২৩৪৫৬৭৮');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.displayValue).toBe('01712345678');
  });

  it('7. Handles mixed Bengali and ASCII digits', () => {
    const res = normalizePhone('০১৭১234৫৬78');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.displayValue).toBe('01712345678');
  });

  it('8. Handles spaces, hyphens, and parentheses (+880 (1712) 345-678)', () => {
    const res = normalizePhone('+880 (1712) 345-678');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.displayValue).toBe('01712345678');
  });

  it('9. Produces exact canonical E.164 normalized mobile: +8801712345678', () => {
    const res = normalizePhone('01712345678');
    expect(res.normalizedValue).toBe('+8801712345678');
  });

  it('10. Produces exact 11-digit display mobile: 01712345678', () => {
    const res = normalizePhone('+8801712345678');
    expect(res.displayValue).toBe('01712345678');
  });

  it('11. Valid mobile status is ContactStatus.FOUND, NEVER VERIFIED', () => {
    const res = normalizePhone('01712345678');
    expect(res.status).toBe(ContactStatus.FOUND);
    expect(res.status).not.toBe(ContactStatus.VERIFIED);
  });

  it('12. Valid mobile phoneType is PhoneType.MOBILE', () => {
    const res = normalizePhone('01712345678');
    expect(res.phoneType).toBe(PhoneType.MOBILE);
  });

  it('13. Rejects 011 prefix (retired Citycell)', () => {
    const res = normalizePhone('01112345678');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('14. Rejects 012 prefix (invalid operator)', () => {
    const res = normalizePhone('01212345678');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('15. Rejects too-short mobile number', () => {
    const res = normalizePhone('017123456');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('16. Rejects too-long mobile number', () => {
    const res = normalizePhone('0171234567899');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('17. Rejects alphabetic-corrupted phone number without silent stripping', () => {
    const res = normalizePhone('01712abc345678');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('18. Rejects foreign international country codes (+1, +44, +91)', () => {
    expect(normalizePhone('+1-555-123-4567').isValid).toBe(false);
    expect(normalizePhone('+44 20 7946 0958').isValid).toBe(false);
    expect(normalizePhone('+91 98765 43210').isValid).toBe(false);
  });

  it('19. Preserves rawValue on invalid input', () => {
    const input = '  invalid-phone-017123  ';
    const res = normalizePhone(input);
    expect(res.rawValue).toBe(input);
  });

  it('20. Returns ContactStatus.INVALID_FORMAT for invalid input', () => {
    const res = normalizePhone('random string');
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
    expect(res.isValid).toBe(false);
  });

  it('21. Does not fabricate canonical normalizedValue for malformed input', () => {
    const res = normalizePhone('0171234');
    expect(res.normalizedValue).toBeNull();
    expect(res.displayValue).toBeNull();
  });

  it('22. Recognizes valid Dhaka landline and returns LANDLINE + FOUND', () => {
    const res = normalizePhone('028881234');
    expect(res.isValid).toBe(true);
    expect(res.phoneType).toBe(PhoneType.LANDLINE);
    expect(res.status).toBe(ContactStatus.FOUND);
    expect(res.normalizedValue).toBe('+88028881234');
    expect(res.displayValue).toBe('028881234');
  });

  it('23. Accepts 8802 and +8802 Dhaka landline formats', () => {
    expect(normalizePhone('+88028881234').normalizedValue).toBe('+88028881234');
    expect(normalizePhone('88028881234').normalizedValue).toBe('+88028881234');
  });

  it('24. Does not guess ambiguous landline as valid', () => {
    const res = normalizePhone('02123'); // too short for PSTN
    expect(res.isValid).toBe(false);
    expect(res.phoneType).toBe(PhoneType.UNKNOWN);
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('25. Supports all valid Bangladesh mobile operators (013-019)', () => {
    const operators = ['013', '014', '015', '016', '017', '018', '019'];
    for (const op of operators) {
      const number = `${op}12345678`;
      const res = normalizePhone(number);
      expect(res.isValid).toBe(true);
      expect(res.phoneType).toBe(PhoneType.MOBILE);
      expect(res.operatorPrefix).toBe(op);
      expect(res.normalizedValue).toBe(`+880${op.slice(1)}12345678`);
    }
  });
});

describe('M1 Step 3: Website & Domain Normalization', () => {
  it('26. Normalizes bare domain (example.com -> example.com)', () => {
    const res = normalizeWebsite('example.com');
    expect(res.isValid).toBe(true);
    expect(res.normalizedDomain).toBe('example.com');
  });

  it('27. Normalizes www bare domain (www.example.com -> example.com)', () => {
    const res = normalizeWebsite('www.example.com');
    expect(res.isValid).toBe(true);
    expect(res.normalizedDomain).toBe('example.com');
  });

  it('28. Normalizes full HTTPS URL with path, query, fragment (https://www.example.com/path?q=1#test -> example.com)', () => {
    const res = normalizeWebsite('https://www.example.com/path?q=1#test');
    expect(res.isValid).toBe(true);
    expect(res.normalizedDomain).toBe('example.com');
  });

  it('29. Normalizes uppercase HTTPS URL (HTTPS://WWW.Example.COM/path -> example.com)', () => {
    const res = normalizeWebsite('HTTPS://WWW.Example.COM/path');
    expect(res.isValid).toBe(true);
    expect(res.normalizedDomain).toBe('example.com');
  });

  it('30. Explicitly REJECTS localhost', () => {
    expect(normalizeWebsite('localhost').isValid).toBe(false);
    expect(normalizeWebsite('http://localhost:3000').isValid).toBe(false);
  });

  it('31. Explicitly REJECTS IP address (127.0.0.1)', () => {
    expect(normalizeWebsite('127.0.0.1').isValid).toBe(false);
    expect(normalizeWebsite('http://127.0.0.1:8080').isValid).toBe(false);
  });

  it('32. Explicitly REJECTS whitespace text (hello world)', () => {
    expect(normalizeWebsite('hello world').isValid).toBe(false);
  });

  it('33. Explicitly REJECTS single-label non-domain (example)', () => {
    expect(normalizeWebsite('example').isValid).toBe(false);
  });

  it('34. Explicitly REJECTS empty http scheme (http://)', () => {
    expect(normalizeWebsite('http://').isValid).toBe(false);
    expect(normalizeWebsite('https://').isValid).toBe(false);
  });

  it('35. Explicitly REJECTS leading colon-slash (://example.com)', () => {
    expect(normalizeWebsite('://example.com').isValid).toBe(false);
  });

  it('36. Explicitly REJECTS javascript scheme (javascript:alert(1))', () => {
    expect(normalizeWebsite('javascript:alert(1)').isValid).toBe(false);
  });

  it('37. Explicitly REJECTS mailto scheme (mailto:test@example.com)', () => {
    expect(normalizeWebsite('mailto:test@example.com').isValid).toBe(false);
  });

  it('38. Explicitly REJECTS ftp scheme (ftp://example.com)', () => {
    expect(normalizeWebsite('ftp://example.com').isValid).toBe(false);
  });

  it('39. Supports Bangladesh domain extensions (.com.bd, .gov.bd)', () => {
    const res = normalizeWebsite('https://www.business.gov.bd/services');
    expect(res.isValid).toBe(true);
    expect(res.normalizedDomain).toBe('business.gov.bd');
  });
});

describe('M1 Step 3: Email Normalization', () => {
  it('40. Normalizes valid email: User.Name+sales@Example.COM -> User.Name+sales@example.com', () => {
    const res = normalizeEmail('User.Name+sales@Example.COM');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('User.Name+sales@example.com');
    expect(res.localPart).toBe('User.Name+sales'); // local-part case and content preserved
    expect(res.domain).toBe('example.com'); // domain lowercased
    expect(res.status).toBe(ContactStatus.FOUND);
  });

  it('41. Explicitly REJECTS missing domain (user@)', () => {
    const res = normalizeEmail('user@');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('42. Explicitly REJECTS missing local-part (@example.com)', () => {
    const res = normalizeEmail('@example.com');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('43. Explicitly REJECTS internal space (user example@example.com)', () => {
    const res = normalizeEmail('user example@example.com');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('44. Explicitly REJECTS domain without TLD (user@example)', () => {
    const res = normalizeEmail('user@example');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('45. Explicitly REJECTS consecutive dots in domain (user@example..com)', () => {
    const res = normalizeEmail('user@example..com');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('46. Explicitly REJECTS consecutive dots in local-part (user..name@example.com)', () => {
    const res = normalizeEmail('user..name@example.com');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('47. Explicitly REJECTS trailing text (user@example.com extra)', () => {
    const res = normalizeEmail('user@example.com extra');
    expect(res.isValid).toBe(false);
    expect(res.normalizedValue).toBeNull();
    expect(res.status).toBe(ContactStatus.INVALID_FORMAT);
  });

  it('48. NEVER removes Gmail dots', () => {
    const res = normalizeEmail('john.doe.personal@gmail.com');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('john.doe.personal@gmail.com');
  });

  it('49. NEVER removes plus aliases', () => {
    const res = normalizeEmail('john+leadmate_m1@example.com');
    expect(res.isValid).toBe(true);
    expect(res.normalizedValue).toBe('john+leadmate_m1@example.com');
  });

  it('50. Email normalization returns ContactStatus.FOUND, NEVER VERIFIED', () => {
    const res = normalizeEmail('sales@leadmate.ai');
    expect(res.status).toBe(ContactStatus.FOUND);
    expect(res.status).not.toBe(ContactStatus.VERIFIED);
  });
});

describe('M1 Step 3: Contact Normalization Orchestrator & WhatsApp Safety', () => {
  it('51. PHONE normalization NEVER infers WhatsApp availability (whatsappStatus = UNKNOWN)', () => {
    const res = normalizeContact({
      type: ContactType.PHONE,
      rawValue: '01712345678'
    });

    expect(res.isValid).toBe(true);
    expect(res.type).toBe(ContactType.PHONE);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
    expect(res.status).toBe(ContactStatus.FOUND);
  });

  it('52. WHATSAPP contact defaults to WhatsAppStatus.UNKNOWN without evidence', () => {
    const res = normalizeContact({
      type: ContactType.WHATSAPP,
      rawValue: '01712345678'
    });

    expect(res.isValid).toBe(true);
    expect(res.type).toBe(ContactType.WHATSAPP);
    expect(res.normalizedValue).toBe('+8801712345678');
    expect(res.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
  });

  it('53. Preserves evidence-backed PUBLICLY_LISTED status for WHATSAPP', () => {
    const res = normalizeContact({
      type: ContactType.WHATSAPP,
      rawValue: '+8801712345678',
      whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED
    });

    expect(res.isValid).toBe(true);
    expect(res.whatsappStatus).toBe(WhatsAppStatus.PUBLICLY_LISTED);
  });

  it('54. Normalization NEVER infers or outputs WhatsAppStatus.CONFIRMED', () => {
    const res = normalizeContact({
      type: ContactType.WHATSAPP,
      rawValue: '01712345678',
      whatsappStatus: WhatsAppStatus.CONFIRMED // Attempting unverified CONFIRMED during normalization
    });

    expect(res.isValid).toBe(true);
    // Must NOT be CONFIRMED (verification requires explicit verification workflow)
    expect(res.whatsappStatus).not.toBe(WhatsAppStatus.CONFIRMED);
    expect(res.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
  });

  it('55. Normalizes EMAIL contact via orchestrator', () => {
    const res = normalizeContact({
      type: ContactType.EMAIL,
      rawValue: ' Info@Dentist.COM.BD ',
      isPrimary: true
    });

    expect(res.isValid).toBe(true);
    expect(res.type).toBe(ContactType.EMAIL);
    expect(res.normalizedValue).toBe('Info@dentist.com.bd');
    expect(res.phoneType).toBeNull();
    expect(res.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
    expect(res.isPrimary).toBe(true);
  });
});
