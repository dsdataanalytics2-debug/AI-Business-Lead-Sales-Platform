import { describe, it, expect, vi } from 'vitest';
import {
  MetaWhatsAppDeliveryProvider,
  META_WHATSAPP_PROVIDER_NAME,
  DEFAULT_META_WHATSAPP_API_VERSION,
  DEFAULT_META_WHATSAPP_TIMEOUT_MS,
  validateMetaWhatsAppConfig,
  type MetaWhatsAppProviderConfig
} from '../outreach/meta-whatsapp-provider.js';
import {
  OutreachChannel,
  OutreachErrorCode
} from '@leadmate/shared';
import {
  OutreachDeliveryProviderError,
  OutreachProviderErrorCode,
  mapProviderErrorToPublicErrorCode,
  type WhatsAppOutreachProviderSendInput
} from '../index.js';

describe('Meta WhatsApp Delivery Provider Adapter', () => {
  const validConfig: MetaWhatsAppProviderConfig = {
    accessToken: 'test-meta-access-token-999',
    phoneNumberId: '123456789012345',
    apiVersion: 'v22.0',
    baseUrl: 'https://graph.facebook.com',
    timeoutMs: 5000
  };

  const sampleInput: WhatsAppOutreachProviderSendInput = {
    deliveryId: 'del-meta-001',
    organizationId: 'org-meta-001',
    channel: OutreachChannel.WHATSAPP,
    recipientNormalized: '+8801711223344',
    content: 'Hello! Your LeadMate proposal is ready.',
    providerIdempotencyToken: 'del-meta-001'
  };

  describe('Configuration Validation', () => {
    it('succeeds with valid configuration', () => {
      expect(() => validateMetaWhatsAppConfig(validConfig)).not.toThrow();
    });

    it('fails closed when accessToken is missing or empty', () => {
      expect(() =>
        validateMetaWhatsAppConfig({ ...validConfig, accessToken: '' })
      ).toThrow('accessToken is required');
    });

    it('fails closed when phoneNumberId is missing or empty', () => {
      expect(() =>
        validateMetaWhatsAppConfig({ ...validConfig, phoneNumberId: '  ' })
      ).toThrow('phoneNumberId is required');
    });

    it('fails closed when timeoutMs is non-positive', () => {
      expect(() =>
        validateMetaWhatsAppConfig({ ...validConfig, timeoutMs: -10 })
      ).toThrow('timeoutMs must be a positive integer');
    });
  });

  describe('Outbound Send Execution', () => {
    it('dispatches valid text message and returns accepted message identifier', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '8801711223344', wa_id: '8801711223344' }],
          messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5MDEyMzQ1FQIAERgSMTQ...' }]
        })
      });

      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch as any,
        clock: () => new Date('2026-10-07T12:00:00Z')
      });

      expect(provider.name).toBe(META_WHATSAPP_PROVIDER_NAME);
      expect(provider.channel).toBe(OutreachChannel.WHATSAPP);

      const result = await provider.send(sampleInput);

      expect(result.providerName).toBe(META_WHATSAPP_PROVIDER_NAME);
      expect(result.providerMessageId).toBe('wamid.HBgLMTIzNDU2Nzg5MDEyMzQ1FQIAERgSMTQ...');
      expect(result.acceptedAt).toEqual(new Date('2026-10-07T12:00:00Z'));

      // Verify endpoint shape
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/v22.0/123456789012345/messages');
      expect(init.method).toBe('POST');
      expect(init.headers['Authorization']).toBe('Bearer test-meta-access-token-999');
      expect(init.headers['Content-Type']).toBe('application/json');

      const parsedBody = JSON.parse(init.body);
      expect(parsedBody.messaging_product).toBe('whatsapp');
      expect(parsedBody.to).toBe('8801711223344'); // stripped leading +
      expect(parsedBody.type).toBe('text');
      expect(parsedBody.text.body).toBe('Hello! Your LeadMate proposal is ready.');
    });

    it('fails closed with INVALID_INPUT if deliveryId is missing', async () => {
      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: vi.fn() as any
      });

      await expect(
        provider.send({ ...sampleInput, deliveryId: '' })
      ).rejects.toThrowError(OutreachDeliveryProviderError);
    });

    it('fails closed with CHANNEL_MISMATCH if non-WHATSAPP channel is supplied', async () => {
      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: vi.fn() as any
      });

      await expect(
        provider.send({
          ...sampleInput,
          channel: OutreachChannel.EMAIL as any,
          body: 'text'
        } as any)
      ).rejects.toThrowError(OutreachDeliveryProviderError);
    });

    it('fails closed with INVALID_INPUT if content is empty', async () => {
      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: vi.fn() as any
      });

      await expect(
        provider.send({ ...sampleInput, content: '' })
      ).rejects.toThrowError(OutreachDeliveryProviderError);
    });

    it('maps HTTP 429 / rate limit error to PROVIDER_RATE_LIMITED (retryable: true)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            message: 'Message rate limit exceeded',
            type: 'OAuthException',
            code: 130429,
            fbtrace_id: 'xyz'
          }
        })
      });

      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch as any
      });

      try {
        await provider.send(sampleInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const provErr = err as OutreachDeliveryProviderError;
        expect(provErr.code).toBe(OutreachProviderErrorCode.PROVIDER_RATE_LIMITED);
        expect(provErr.retryable).toBe(true);
        expect(mapProviderErrorToPublicErrorCode(provErr)).toBe(
          OutreachErrorCode.OUTREACH_PROVIDER_RATE_LIMITED
        );
      }
    });

    it('maps HTTP 500 / 503 upstream error to PROVIDER_UNAVAILABLE (retryable: true)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          error: { message: 'Service temporarily unavailable', code: 2 }
        })
      });

      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch as any
      });

      try {
        await provider.send(sampleInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const provErr = err as OutreachDeliveryProviderError;
        expect(provErr.code).toBe(OutreachProviderErrorCode.PROVIDER_UNAVAILABLE);
        expect(provErr.retryable).toBe(true);
      }
    });

    it('maps recipient rejection (e.g. code 131026) to RECIPIENT_REJECTED (retryable: false)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Undeliverable message',
            code: 131026,
            error_data: { details: 'Recipient is not registered' }
          }
        })
      });

      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch as any
      });

      try {
        await provider.send(sampleInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const provErr = err as OutreachDeliveryProviderError;
        expect(provErr.code).toBe(OutreachProviderErrorCode.RECIPIENT_REJECTED);
        expect(provErr.retryable).toBe(false);
        expect(mapProviderErrorToPublicErrorCode(provErr)).toBe(
          OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED
        );
      }
    });

    it('maps messaging window / template restriction (e.g. code 131047) to CONTENT_REJECTED (retryable: false)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Re-engagement message requires template',
            code: 131047
          }
        })
      });

      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch as any
      });

      try {
        await provider.send(sampleInput);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const provErr = err as OutreachDeliveryProviderError;
        expect(provErr.code).toBe(OutreachProviderErrorCode.CONTENT_REJECTED);
        expect(provErr.retryable).toBe(false);
        expect(mapProviderErrorToPublicErrorCode(provErr)).toBe(
          OutreachErrorCode.OUTREACH_CONTENT_REJECTED
        );
      }
    });

    it('maps network abort / timeout to PROVIDER_TIMEOUT (retryable: true)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const mockFetch = vi.fn().mockImplementation((_url, init) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(abortError);
          });
        });
      });

      const provider = new MetaWhatsAppDeliveryProvider({
        config: { ...validConfig, timeoutMs: 10 },
        fetchFn: mockFetch as any
      });

      try {
        await provider.send(sampleInput);
        expect.unreachable('Should have timed out');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const provErr = err as OutreachDeliveryProviderError;
        expect(provErr.code).toBe(OutreachProviderErrorCode.PROVIDER_TIMEOUT);
        expect(provErr.retryable).toBe(true);
      }
    });

    it('maps malformed 200 response missing messages array to INVALID_PROVIDER_RESPONSE', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }) // Missing messages array
      });

      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch as any
      });

      try {
        await provider.send(sampleInput);
        expect.unreachable('Should have thrown on missing message ID');
      } catch (err) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        const provErr = err as OutreachDeliveryProviderError;
        expect(provErr.code).toBe(OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE);
        expect(provErr.retryable).toBe(false);
        expect(mapProviderErrorToPublicErrorCode(provErr)).toBe(
          OutreachErrorCode.OUTREACH_PROVIDER_BAD_GATEWAY
        );
      }
    });

    it('never leaks access token or app secret in error message or representation', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            message: 'Invalid OAuth access token test-meta-access-token-999',
            code: 190
          }
        })
      });

      const provider = new MetaWhatsAppDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch as any
      });

      try {
        await provider.send(sampleInput);
        expect.unreachable('Should have thrown on 401');
      } catch (err) {
        const provErr = err as OutreachDeliveryProviderError;
        const serialized = JSON.stringify(provErr.toJSON());
        expect(serialized).not.toContain('test-meta-access-token-999');
        expect(provErr.safeMessage).not.toContain('test-meta-access-token-999');
      }
    });
  });
});
