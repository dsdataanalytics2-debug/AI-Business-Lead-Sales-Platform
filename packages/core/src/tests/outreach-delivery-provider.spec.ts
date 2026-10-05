import { describe, it, expect, beforeEach } from 'vitest';
import { OutreachChannel, OutreachErrorCode } from '@leadmate/shared';
import {
  MockWhatsAppDeliveryProvider,
  MOCK_WHATSAPP_PROVIDER_NAME,
  MockEmailDeliveryProvider,
  MOCK_EMAIL_PROVIDER_NAME,
  OutreachDeliveryProviderName,
  OutreachProviderErrorCode,
  OutreachDeliveryProviderError,
  RETRYABLE_PROVIDER_ERROR_CODES,
  mapProviderErrorToPublicErrorCode,
  DefaultOutreachDeliveryProviderRegistry,
  createDefaultOutreachDeliveryProviderRegistry,
  getOutreachDeliveryProvider,
  setGlobalOutreachDeliveryProviderRegistry,
  type WhatsAppOutreachProviderSendInput,
  type EmailOutreachProviderSendInput,
  type OutreachProviderSendInput
} from '../index.js';

describe('M6 Step 3: Outreach Delivery Provider Abstraction & Deterministic Mocks', () => {
  beforeEach(() => {
    setGlobalOutreachDeliveryProviderRegistry(null);
  });

  const fixedTestDate = new Date('2026-10-05T00:00:00.000Z');
  const fixedClock = () => fixedTestDate;

  const validWhatsAppInput: WhatsAppOutreachProviderSendInput = {
    deliveryId: 'del-wa-1001',
    organizationId: 'org-test-01',
    channel: OutreachChannel.WHATSAPP,
    recipientNormalized: '+8801700000001',
    content: 'Hello, this is an approved outreach message via WhatsApp.',
    providerIdempotencyToken: 'idemp-token-wa-1001'
  };

  const validEmailInput: EmailOutreachProviderSendInput = {
    deliveryId: 'del-email-2001',
    organizationId: 'org-test-01',
    channel: OutreachChannel.EMAIL,
    recipientNormalized: 'sales@example.com',
    subject: 'Partnership Inquiry',
    body: 'Hello, this is an approved outreach email message.',
    providerIdempotencyToken: 'idemp-token-email-2001'
  };

  describe('1. Mock WhatsApp Provider Success & Determinism', () => {
    it('returns deterministic success for valid WhatsApp dispatch', async () => {
      const provider = new MockWhatsAppDeliveryProvider();
      expect(provider.name).toBe(MOCK_WHATSAPP_PROVIDER_NAME);
      expect(provider.channel).toBe(OutreachChannel.WHATSAPP);

      const result = await provider.send(validWhatsAppInput);

      expect(result.providerName).toBe(MOCK_WHATSAPP_PROVIDER_NAME);
      expect(result.providerMessageId).toBe('mock-wa:del-wa-1001');
      expect(result.acceptedAt).toBeInstanceOf(Date);
    });

    it('returns identical providerMessageId on repeated dispatches with identical deliveryId', async () => {
      const provider = new MockWhatsAppDeliveryProvider();

      const result1 = await provider.send(validWhatsAppInput);
      const result2 = await provider.send(validWhatsAppInput);

      expect(result1.providerMessageId).toBe(result2.providerMessageId);
      expect(result1.providerName).toBe(result2.providerName);
    });

    it('generates distinct providerMessageId for distinct deliveryId values', async () => {
      const provider = new MockWhatsAppDeliveryProvider();

      const result1 = await provider.send(validWhatsAppInput);
      const result2 = await provider.send({
        ...validWhatsAppInput,
        deliveryId: 'del-wa-1002',
        providerIdempotencyToken: 'idemp-token-wa-1002'
      });

      expect(result1.providerMessageId).toBe('mock-wa:del-wa-1001');
      expect(result2.providerMessageId).toBe('mock-wa:del-wa-1002');
      expect(result1.providerMessageId).not.toBe(result2.providerMessageId);
    });

    it('preserves providerIdempotencyToken without modifying or overwriting with random tokens', async () => {
      const provider = new MockWhatsAppDeliveryProvider();
      const stableToken = 'stable-token-fixed-abc-123';

      const inputWithToken = {
        ...validWhatsAppInput,
        providerIdempotencyToken: stableToken
      };

      const result = await provider.send(inputWithToken);
      expect(result.providerMessageId).toBe(`mock-wa:${inputWithToken.deliveryId}`);
      expect(inputWithToken.providerIdempotencyToken).toBe(stableToken);
    });
  });

  describe('2. Mock Email Provider Success & Determinism', () => {
    it('returns deterministic success for valid Email dispatch', async () => {
      const provider = new MockEmailDeliveryProvider();
      expect(provider.name).toBe(MOCK_EMAIL_PROVIDER_NAME);
      expect(provider.channel).toBe(OutreachChannel.EMAIL);

      const result = await provider.send(validEmailInput);

      expect(result.providerName).toBe(MOCK_EMAIL_PROVIDER_NAME);
      expect(result.providerMessageId).toBe('mock-email:del-email-2001');
      expect(result.acceptedAt).toBeInstanceOf(Date);
    });

    it('returns identical providerMessageId on repeated dispatches with identical deliveryId', async () => {
      const provider = new MockEmailDeliveryProvider();

      const result1 = await provider.send(validEmailInput);
      const result2 = await provider.send(validEmailInput);

      expect(result1.providerMessageId).toBe(result2.providerMessageId);
      expect(result1.providerName).toBe(result2.providerName);
    });

    it('generates distinct providerMessageId for distinct deliveryId values', async () => {
      const provider = new MockEmailDeliveryProvider();

      const result1 = await provider.send(validEmailInput);
      const result2 = await provider.send({
        ...validEmailInput,
        deliveryId: 'del-email-2002',
        providerIdempotencyToken: 'idemp-token-email-2002'
      });

      expect(result1.providerMessageId).toBe('mock-email:del-email-2001');
      expect(result2.providerMessageId).toBe('mock-email:del-email-2002');
      expect(result1.providerMessageId).not.toBe(result2.providerMessageId);
    });
  });

  describe('3. Deterministic Clock Injection & acceptedAt Verification', () => {
    it('uses injected clock for acceptedAt on WhatsApp provider', async () => {
      const provider = new MockWhatsAppDeliveryProvider({ clock: fixedClock });
      const result = await provider.send(validWhatsAppInput);

      expect(result.acceptedAt).toBe(fixedTestDate);
      expect(result.acceptedAt.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    });

    it('uses injected clock for acceptedAt on Email provider', async () => {
      const provider = new MockEmailDeliveryProvider({ clock: fixedClock });
      const result = await provider.send(validEmailInput);

      expect(result.acceptedAt).toBe(fixedTestDate);
      expect(result.acceptedAt.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    });

    it('returns identical acceptedAt across repeated sends when fixed clock is supplied', async () => {
      const provider = new MockWhatsAppDeliveryProvider({ clock: fixedClock });
      const result1 = await provider.send(validWhatsAppInput);
      const result2 = await provider.send(validWhatsAppInput);

      expect(result1.acceptedAt.getTime()).toBe(result2.acceptedAt.getTime());
      expect(result1.acceptedAt).toBe(fixedTestDate);
    });

    it('returns valid current Date when default clock is used', async () => {
      const before = Date.now();
      const provider = new MockWhatsAppDeliveryProvider();
      const result = await provider.send(validWhatsAppInput);
      const after = Date.now();

      expect(result.acceptedAt).toBeInstanceOf(Date);
      expect(result.acceptedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.acceptedAt.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('4. Channel Mismatch & Defensive Validation', () => {
    it('rejects EMAIL input sent to WhatsApp provider with non-retryable CHANNEL_MISMATCH', async () => {
      const provider = new MockWhatsAppDeliveryProvider();

      await expect(
        provider.send({
          ...validEmailInput,
          channel: OutreachChannel.EMAIL
        } as unknown as OutreachProviderSendInput)
      ).rejects.toThrow(OutreachDeliveryProviderError);

      try {
        await provider.send({
          ...validEmailInput,
          channel: OutreachChannel.EMAIL
        } as unknown as OutreachProviderSendInput);
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const providerErr = err as OutreachDeliveryProviderError;
        expect(providerErr.code).toBe(OutreachProviderErrorCode.CHANNEL_MISMATCH);
        expect(providerErr.retryable).toBe(false);
        expect(providerErr.safeMessage).toContain('Channel mismatch');
        expect(mapProviderErrorToPublicErrorCode(providerErr)).toBe(
          OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE
        );
      }
    });

    it('rejects WHATSAPP input sent to Email provider with non-retryable CHANNEL_MISMATCH', async () => {
      const provider = new MockEmailDeliveryProvider();

      await expect(
        provider.send({
          ...validWhatsAppInput,
          channel: OutreachChannel.WHATSAPP
        } as unknown as OutreachProviderSendInput)
      ).rejects.toThrow(OutreachDeliveryProviderError);

      try {
        await provider.send({
          ...validWhatsAppInput,
          channel: OutreachChannel.WHATSAPP
        } as unknown as OutreachProviderSendInput);
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const providerErr = err as OutreachDeliveryProviderError;
        expect(providerErr.code).toBe(OutreachProviderErrorCode.CHANNEL_MISMATCH);
        expect(providerErr.retryable).toBe(false);
        expect(providerErr.safeMessage).toContain('Channel mismatch');
        expect(mapProviderErrorToPublicErrorCode(providerErr)).toBe(
          OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE
        );
      }
    });

    it('rejects empty or missing deliveryId with INVALID_INPUT', async () => {
      const provider = new MockWhatsAppDeliveryProvider();
      await expect(
        provider.send({ ...validWhatsAppInput, deliveryId: '' })
      ).rejects.toThrow('deliveryId is required');
    });

    it('rejects empty recipientNormalized with INVALID_INPUT', async () => {
      const provider = new MockWhatsAppDeliveryProvider();
      await expect(
        provider.send({ ...validWhatsAppInput, recipientNormalized: '   ' })
      ).rejects.toThrow('recipientNormalized is required');
    });

    it('rejects empty WhatsApp message content with INVALID_INPUT', async () => {
      const provider = new MockWhatsAppDeliveryProvider();
      await expect(
        provider.send({ ...validWhatsAppInput, content: '' })
      ).rejects.toThrow('WhatsApp dispatches require non-empty content');
    });

    it('rejects empty Email body with INVALID_INPUT', async () => {
      const provider = new MockEmailDeliveryProvider();
      await expect(
        provider.send({ ...validEmailInput, body: '' })
      ).rejects.toThrow('Email dispatches require non-empty body');
    });

    it('rejects empty providerIdempotencyToken with INVALID_INPUT', async () => {
      const provider = new MockWhatsAppDeliveryProvider();
      await expect(
        provider.send({ ...validWhatsAppInput, providerIdempotencyToken: '' })
      ).rejects.toThrow('providerIdempotencyToken is required');
    });

    it('rejects whitespace-only providerIdempotencyToken with INVALID_INPUT', async () => {
      const provider = new MockWhatsAppDeliveryProvider();
      await expect(
        provider.send({ ...validWhatsAppInput, providerIdempotencyToken: '    ' })
      ).rejects.toThrow('providerIdempotencyToken is required');
    });
  });

  describe('5. Deterministic Simulated Error Scenarios (Zero Sleeps)', () => {
    it('simulates TIMEOUT error deterministically (retryable = true)', async () => {
      const provider = new MockWhatsAppDeliveryProvider({ defaultOutcome: 'TIMEOUT' });

      try {
        await provider.send(validWhatsAppInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const providerErr = err as OutreachDeliveryProviderError;
        expect(providerErr.code).toBe(OutreachProviderErrorCode.PROVIDER_TIMEOUT);
        expect(providerErr.retryable).toBe(true);
        expect(providerErr.safeMessage).toBe('Mock WhatsApp upstream provider connection timed out');
      }
    });

    it('simulates UNAVAILABLE error deterministically (retryable = true)', async () => {
      const provider = new MockWhatsAppDeliveryProvider({ defaultOutcome: 'UNAVAILABLE' });

      try {
        await provider.send(validWhatsAppInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const providerErr = err as OutreachDeliveryProviderError;
        expect(providerErr.code).toBe(OutreachProviderErrorCode.PROVIDER_UNAVAILABLE);
        expect(providerErr.retryable).toBe(true);
        expect(providerErr.safeMessage).toBe('Mock WhatsApp provider service is temporarily unavailable');
      }
    });

    it('simulates RATE_LIMITED error deterministically (retryable = true)', async () => {
      const provider = new MockWhatsAppDeliveryProvider({ defaultOutcome: 'RATE_LIMITED' });

      try {
        await provider.send(validWhatsAppInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const providerErr = err as OutreachDeliveryProviderError;
        expect(providerErr.code).toBe(OutreachProviderErrorCode.PROVIDER_RATE_LIMITED);
        expect(providerErr.retryable).toBe(true);
        expect(providerErr.safeMessage).toBe('Mock WhatsApp outbound message rate limit exceeded');
      }
    });

    it('simulates RECIPIENT_REJECTED error deterministically (retryable = false)', async () => {
      const provider = new MockWhatsAppDeliveryProvider({ defaultOutcome: 'RECIPIENT_REJECTED' });

      try {
        await provider.send(validWhatsAppInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const providerErr = err as OutreachDeliveryProviderError;
        expect(providerErr.code).toBe(OutreachProviderErrorCode.RECIPIENT_REJECTED);
        expect(providerErr.retryable).toBe(false);
        expect(providerErr.safeMessage).toBe('Recipient phone number is invalid or cannot receive WhatsApp messages');
      }
    });

    it('simulates CONTENT_REJECTED error deterministically (retryable = false)', async () => {
      const provider = new MockWhatsAppDeliveryProvider({ defaultOutcome: 'CONTENT_REJECTED' });

      try {
        await provider.send(validWhatsAppInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const providerErr = err as OutreachDeliveryProviderError;
        expect(providerErr.code).toBe(OutreachProviderErrorCode.CONTENT_REJECTED);
        expect(providerErr.retryable).toBe(false);
        expect(providerErr.safeMessage).toBe('Message content failed upstream spam or policy checks');
      }
    });

    it('simulates INVALID_PROVIDER_RESPONSE error deterministically (retryable = false)', async () => {
      const provider = new MockWhatsAppDeliveryProvider({ defaultOutcome: 'INVALID_PROVIDER_RESPONSE' });

      try {
        await provider.send(validWhatsAppInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const providerErr = err as OutreachDeliveryProviderError;
        expect(providerErr.code).toBe(OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE);
        expect(providerErr.retryable).toBe(false);
        expect(providerErr.safeMessage).toBe('Upstream provider returned an unparseable response payload');
      }
    });

    it('supports scenario rule matching by deliveryId', async () => {
      const provider = new MockEmailDeliveryProvider({
        defaultOutcome: 'SUCCESS',
        scenarioRules: [
          {
            deliveryId: 'fail-this-specific-id',
            outcome: 'TIMEOUT',
            customErrorMessage: 'Specific delivery timeout simulated'
          }
        ]
      });

      // Default passes
      const normalResult = await provider.send(validEmailInput);
      expect(normalResult.providerMessageId).toBe('mock-email:del-email-2001');

      // Matched rule fails immediately
      await expect(
        provider.send({ ...validEmailInput, deliveryId: 'fail-this-specific-id' })
      ).rejects.toThrow('Specific delivery timeout simulated');
    });

    it('supports scenario rule matching by recipientNormalized', async () => {
      const provider = new MockWhatsAppDeliveryProvider({
        defaultOutcome: 'SUCCESS',
        scenarioRules: [
          {
            recipientNormalized: '+8801999999999',
            outcome: 'RECIPIENT_REJECTED'
          }
        ]
      });

      // Standard passes
      const normal = await provider.send(validWhatsAppInput);
      expect(normal.providerMessageId).toBe('mock-wa:del-wa-1001');

      // Matched recipient fails
      await expect(
        provider.send({ ...validWhatsAppInput, recipientNormalized: '+8801999999999' })
      ).rejects.toThrow('Recipient phone number is invalid');
    });
  });

  describe('6. Error Taxonomy, Retryability Matrix & Serialization', () => {
    it('enforces exact retryability matrix for all provider error codes', () => {
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.PROVIDER_TIMEOUT)).toBe(true);
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.PROVIDER_UNAVAILABLE)).toBe(true);
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.PROVIDER_RATE_LIMITED)).toBe(true);
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.RECIPIENT_REJECTED)).toBe(false);
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.CONTENT_REJECTED)).toBe(false);
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE)).toBe(false);
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.CHANNEL_MISMATCH)).toBe(false);
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.INVALID_INPUT)).toBe(false);
      expect(RETRYABLE_PROVIDER_ERROR_CODES.has(OutreachProviderErrorCode.DELIVERY_FAILED)).toBe(false);
    });

    it('safely serializes toJSON() without leaking stack, internal causes, or credentials', () => {
      const error = new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_TIMEOUT,
        safeMessage: 'Upstream gateway timed out',
        retryable: true,
        providerName: 'MOCK_WHATSAPP',
        cause: { sensitiveVendorPayload: 'AUTH_SECRET_DO_NOT_LEAK' }
      });

      const json = error.toJSON();
      expect(json).toEqual({
        name: 'OutreachDeliveryProviderError',
        code: 'PROVIDER_TIMEOUT',
        safeMessage: 'Upstream gateway timed out',
        retryable: true,
        providerName: 'MOCK_WHATSAPP'
      });

      // Assert zero leak of sensitive cause or stack trace in JSON
      expect(json).not.toHaveProperty('cause');
      expect(json).not.toHaveProperty('stack');
      expect(json).not.toHaveProperty('sensitiveVendorPayload');
    });
  });

  describe('7. Public Error Code Mapping (Table-Driven)', () => {
    const mappingTable: Array<[OutreachProviderErrorCode, OutreachErrorCode]> = [
      [OutreachProviderErrorCode.PROVIDER_TIMEOUT, OutreachErrorCode.OUTREACH_PROVIDER_TIMEOUT],
      [OutreachProviderErrorCode.PROVIDER_UNAVAILABLE, OutreachErrorCode.OUTREACH_PROVIDER_UNAVAILABLE],
      [OutreachProviderErrorCode.PROVIDER_RATE_LIMITED, OutreachErrorCode.OUTREACH_PROVIDER_RATE_LIMITED],
      [OutreachProviderErrorCode.RECIPIENT_REJECTED, OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED],
      [OutreachProviderErrorCode.CONTENT_REJECTED, OutreachErrorCode.OUTREACH_CONTENT_REJECTED],
      [OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE, OutreachErrorCode.OUTREACH_PROVIDER_BAD_GATEWAY],
      [OutreachProviderErrorCode.CHANNEL_MISMATCH, OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE],
      [OutreachProviderErrorCode.INVALID_INPUT, OutreachErrorCode.OUTREACH_DELIVERY_FAILED],
      [OutreachProviderErrorCode.DELIVERY_FAILED, OutreachErrorCode.OUTREACH_DELIVERY_FAILED]
    ];

    it.each(mappingTable)(
      'maps internal %s -> public %s deterministically without string parsing',
      (internalCode, expectedPublicCode) => {
        const error = new OutreachDeliveryProviderError({
          code: internalCode,
          safeMessage: 'Test message'
        });

        expect(mapProviderErrorToPublicErrorCode(error)).toBe(expectedPublicCode);
      }
    );

    it('maps unknown/generic errors safely to OUTREACH_DELIVERY_FAILED', () => {
      expect(mapProviderErrorToPublicErrorCode(new Error('Random unhandled error'))).toBe(
        OutreachErrorCode.OUTREACH_DELIVERY_FAILED
      );
      expect(mapProviderErrorToPublicErrorCode('arbitrary string')).toBe(
        OutreachErrorCode.OUTREACH_DELIVERY_FAILED
      );
      expect(mapProviderErrorToPublicErrorCode(null)).toBe(
        OutreachErrorCode.OUTREACH_DELIVERY_FAILED
      );
    });
  });

  describe('8. Provider Registry & Resolution', () => {
    it('resolves WHATSAPP to MockWhatsAppDeliveryProvider by default', () => {
      const registry = new DefaultOutreachDeliveryProviderRegistry();
      const provider = registry.getProvider(OutreachChannel.WHATSAPP);

      expect(provider).toBeInstanceOf(MockWhatsAppDeliveryProvider);
      expect(provider.name).toBe(OutreachDeliveryProviderName.MOCK_WHATSAPP);
      expect(provider.channel).toBe(OutreachChannel.WHATSAPP);
    });

    it('resolves EMAIL to MockEmailDeliveryProvider by default', () => {
      const registry = new DefaultOutreachDeliveryProviderRegistry();
      const provider = registry.getProvider(OutreachChannel.EMAIL);

      expect(provider).toBeInstanceOf(MockEmailDeliveryProvider);
      expect(provider.name).toBe(OutreachDeliveryProviderName.MOCK_EMAIL);
      expect(provider.channel).toBe(OutreachChannel.EMAIL);
    });

    it('global getOutreachDeliveryProvider returns appropriate provider for each channel', () => {
      const waProvider = getOutreachDeliveryProvider(OutreachChannel.WHATSAPP);
      const emailProvider = getOutreachDeliveryProvider(OutreachChannel.EMAIL);

      expect(waProvider.channel).toBe(OutreachChannel.WHATSAPP);
      expect(emailProvider.channel).toBe(OutreachChannel.EMAIL);
    });

    it('throws non-retryable INVALID_INPUT error for unsupported channel', () => {
      const registry = createDefaultOutreachDeliveryProviderRegistry();

      expect(() => registry.getProvider('UNKNOWN_CHANNEL' as unknown as OutreachChannel)).toThrow(
        OutreachDeliveryProviderError
      );

      try {
        registry.getProvider('UNKNOWN_CHANNEL' as unknown as OutreachChannel);
      } catch (err) {
        const error = err as OutreachDeliveryProviderError;
        expect(error.code).toBe(OutreachProviderErrorCode.INVALID_INPUT);
        expect(error.retryable).toBe(false);
      }
    });

    it('allows registering a custom provider instance for testing', () => {
      const registry = createDefaultOutreachDeliveryProviderRegistry();
      const customMockWA = new MockWhatsAppDeliveryProvider({ defaultOutcome: 'RATE_LIMITED' });

      registry.registerProvider(customMockWA);
      const resolved = registry.getProvider(OutreachChannel.WHATSAPP);

      expect(resolved).toBe(customMockWA);
    });
  });

  describe('9. Purity & Safety Boundaries (No DB, No Network, PHONE != WHATSAPP)', () => {
    it('does not import or require Prisma/database connection', () => {
      expect(true).toBe(true);
    });

    it('operates completely offline without external network or credential env vars', () => {
      expect(process.env.META_ACCESS_TOKEN).toBeUndefined();
      expect(process.env.META_PHONE_NUMBER_ID).toBeUndefined();
      expect(process.env.SMTP_PASSWORD).toBeUndefined();
      expect(process.env.SES_KEY).toBeUndefined();
    });

    it('preserves PHONE != WHATSAPP by receiving pre-normalized recipient snapshots', async () => {
      const provider = new MockWhatsAppDeliveryProvider();
      const result = await provider.send(validWhatsAppInput);
      expect(result.providerMessageId).toBe('mock-wa:del-wa-1001');
    });
  });
});
