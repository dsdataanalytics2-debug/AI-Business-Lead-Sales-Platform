/**
 * Contact Normalization Orchestrator
 *
 * Dispatches raw contact values to the appropriate specialized normalizer
 * (phone, email, WhatsApp) and enforces strict safety and WhatsApp status policies.
 *
 * CRITICAL SAFETY RULES:
 * 1. Phone normalization NEVER infers WhatsApp availability (whatsappStatus defaults to UNKNOWN).
 * 2. Normalization NEVER outputs WhatsAppStatus.CONFIRMED (verification is a separate explicit workflow).
 * 3. Evidence-backed WhatsAppStatus.PUBLICLY_LISTED can be preserved if supplied from trusted data.
 * 4. Normalization is NOT verification (status is FOUND on valid syntax, never VERIFIED).
 */

import {
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus
} from '@leadmate/shared';
import { normalizePhone } from './phone.js';
import { normalizeEmail } from './email.js';

export interface ContactNormalizationInput {
  type: ContactType;
  rawValue: string;
  isPrimary?: boolean;
  whatsappStatus?: WhatsAppStatus;
}

export interface NormalizedContactResult {
  type: ContactType;
  rawValue: string;
  normalizedValue: string | null;
  displayValue: string | null;
  phoneType: PhoneType | null;
  status: ContactStatus;
  whatsappStatus: WhatsAppStatus;
  isPrimary: boolean;
  isValid: boolean;
  error: string | null;
}

/**
 * Normalizes any contact based on its ContactType.
 *
 * @param input - Raw contact input with type, value, and optional metadata
 * @returns Structured NormalizedContactResult
 */
export function normalizeContact(input: ContactNormalizationInput): NormalizedContactResult {
  const isPrimary = Boolean(input.isPrimary);
  const rawValue = typeof input.rawValue === 'string' ? input.rawValue : '';

  switch (input.type) {
    case ContactType.PHONE: {
      const phoneRes = normalizePhone(rawValue);
      return {
        type: ContactType.PHONE,
        rawValue: phoneRes.rawValue,
        normalizedValue: phoneRes.normalizedValue,
        displayValue: phoneRes.displayValue,
        phoneType: phoneRes.phoneType,
        status: phoneRes.status,
        whatsappStatus: WhatsAppStatus.UNKNOWN, // PHONE normalization NEVER infers WhatsApp
        isPrimary,
        isValid: phoneRes.isValid,
        error: phoneRes.error
      };
    }

    case ContactType.WHATSAPP: {
      const phoneRes = normalizePhone(rawValue);

      // Enforce WhatsApp status policy:
      // - If supplied as PUBLICLY_LISTED (e.g. wa.me link in listing), preserve it.
      // - NEVER automatically set or preserve CONFIRMED during normalization.
      let whatsappStatus = WhatsAppStatus.UNKNOWN;
      if (input.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED) {
        whatsappStatus = WhatsAppStatus.PUBLICLY_LISTED;
      }

      return {
        type: ContactType.WHATSAPP,
        rawValue: phoneRes.rawValue,
        normalizedValue: phoneRes.normalizedValue,
        displayValue: phoneRes.displayValue,
        phoneType: phoneRes.phoneType,
        status: phoneRes.status,
        whatsappStatus,
        isPrimary,
        isValid: phoneRes.isValid,
        error: phoneRes.error
      };
    }

    case ContactType.EMAIL: {
      const emailRes = normalizeEmail(rawValue);
      return {
        type: ContactType.EMAIL,
        rawValue: emailRes.rawValue,
        normalizedValue: emailRes.normalizedValue,
        displayValue: emailRes.normalizedValue,
        phoneType: null,
        status: emailRes.status,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary,
        isValid: emailRes.isValid,
        error: emailRes.error
      };
    }

    default: {
      return {
        type: input.type,
        rawValue,
        normalizedValue: null,
        displayValue: null,
        phoneType: null,
        status: ContactStatus.INVALID_FORMAT,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary,
        isValid: false,
        error: `Unsupported contact type: "${input.type}"`
      };
    }
  }
}
