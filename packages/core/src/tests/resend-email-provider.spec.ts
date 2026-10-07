import { describe, it, expect, vi } from 'vitest';
import { OutreachChannel } from '@leadmate/shared';
import {
  ResendEmailDeliveryProvider,
  RESEND_EMAIL_PROVIDER_NAME,
  validateResendEmailConfig,
  type ResendEmailProviderConfig,
  type ResendEmailFetchFn
} from '../outreach/resend-email-provider.js';
import {
  OutreachDeliveryProviderError,
  OutreachProviderErrorCode
} from '../outreach/errors.js';
import type { EmailOutreachProviderSendInput } from '../outreach/interfaces.js';

describe('M6 Step 9B: Resend Live Email Provider', () => {
  const validConfig: ResendEmailProviderConfig = {
    apiKey: 're_123456789_test_key',
    fromEmail: 'notifications@example.com',
    fromName: 'LeadMate Alerts',
    baseUrl: 'https://api.resend.com',
    timeoutMs: 5000
  };

  const validEmailInput: EmailOutreachProviderSendInput = {
    deliveryId: 'del-resend-001',
    organizationId: 'org-test-01',
    channel: OutreachChannel.EMAIL,
    recipientNormalized: 'client@company.com',
    subject: 'Enterprise Proposal',
    body: 'Dear Partner,\n\nHere is your approved enterprise proposal.\n\nBest regards,\nSales Team',
    providerIdempotencyToken: 'idemp-token-resend-001'
  };

  describe('1. Configuration Validation (Fail-Closed)', () => {
    it('throws if config is missing or undefined', () => {
      expect(() => validateResendEmailConfig(undefined as any)).toThrow(
        'Resend Email configuration is required'
      );
    });

    it('throws if apiKey is missing, empty, or whitespace', () => {
      expect(() => validateResendEmailConfig({ ...validConfig, apiKey: '' })).toThrow(
        'apiKey is required'
      );
      expect(() => validateResendEmailConfig({ ...validConfig, apiKey: '   ' })).toThrow(
        'apiKey is required'
      );
    });

    it('throws if fromEmail is missing, empty, or lacks @', () => {
      expect(() => validateResendEmailConfig({ ...validConfig, fromEmail: '' })).toThrow(
        'fromEmail is required'
      );
      expect(() => validateResendEmailConfig({ ...validConfig, fromEmail: 'invalid-email' })).toThrow(
        'must be a valid email address'
      );
    });

    it('throws if timeoutMs is non-positive', () => {
      expect(() => validateResendEmailConfig({ ...validConfig, timeoutMs: 0 })).toThrow(
        'timeoutMs must be a positive integer'
      );
      expect(() => validateResendEmailConfig({ ...validConfig, timeoutMs: -100 })).toThrow(
        'timeoutMs must be a positive integer'
      );
    });

    it('accepts valid configuration without error', () => {
      expect(() => validateResendEmailConfig(validConfig)).not.toThrow();
    });
  });

  describe('2. Input Validation Defense', () => {
    const createProvider = (fetchFn: ResendEmailFetchFn) =>
      new ResendEmailDeliveryProvider({ config: validConfig, fetchFn });

    it('rejects missing or empty deliveryId with INVALID_INPUT', async () => {
      const provider = createProvider(vi.fn());
      await expect(
        provider.send({ ...validEmailInput, deliveryId: '' })
      ).rejects.toMatchObject({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: expect.stringContaining('deliveryId is required')
      });
    });

    it('rejects channel mismatch (e.g. WHATSAPP input) with CHANNEL_MISMATCH', async () => {
      const provider = createProvider(vi.fn());
      await expect(
        provider.send({
          ...validEmailInput,
          channel: OutreachChannel.WHATSAPP as any
        })
      ).rejects.toMatchObject({
        code: OutreachProviderErrorCode.CHANNEL_MISMATCH,
        safeMessage: expect.stringContaining('only accepts EMAIL dispatches')
      });
    });

    it('rejects invalid recipient address without @ with INVALID_INPUT', async () => {
      const provider = createProvider(vi.fn());
      await expect(
        provider.send({ ...validEmailInput, recipientNormalized: 'invalid-address' })
      ).rejects.toMatchObject({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: expect.stringContaining('valid email address')
      });
    });

    it('rejects missing or empty body with INVALID_INPUT', async () => {
      const provider = createProvider(vi.fn());
      await expect(
        provider.send({ ...validEmailInput, body: '' })
      ).rejects.toMatchObject({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: expect.stringContaining('require non-empty body')
      });
    });

    it('rejects missing providerIdempotencyToken with INVALID_INPUT', async () => {
      const provider = createProvider(vi.fn());
      await expect(
        provider.send({ ...validEmailInput, providerIdempotencyToken: '' })
      ).rejects.toMatchObject({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: expect.stringContaining('providerIdempotencyToken is required')
      });
    });
  });

  describe('3. Successful Outbound Transmission & Content Immutability', () => {
    it('constructs correct URL, headers, and request payload with plain text body (no invented HTML)', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      const mockFetch: ResendEmailFetchFn = async (input, init) => {
        capturedUrl = input.toString();
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 're_msg_abc12345' })
        } as unknown as Response;
      };

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      const result = await provider.send(validEmailInput);

      expect(capturedUrl).toBe('https://api.resend.com/emails');
      expect(capturedInit?.method).toBe('POST');

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${validConfig.apiKey}`);
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Idempotency-Key']).toBe(validEmailInput.providerIdempotencyToken);

      const parsedPayload = JSON.parse(capturedInit?.body as string);
      expect(parsedPayload.from).toBe('LeadMate Alerts <notifications@example.com>');
      expect(parsedPayload.to).toEqual(['client@company.com']);
      expect(parsedPayload.subject).toBe('Enterprise Proposal');
      // Verifies snapshot body is sent strictly as text, without invented HTML wrappers or tags
      expect(parsedPayload.text).toBe(validEmailInput.body);
      expect(parsedPayload.html).toBeUndefined();

      expect(result.providerName).toBe(RESEND_EMAIL_PROVIDER_NAME);
      expect(result.providerMessageId).toBe('re_msg_abc12345');
      expect(result.acceptedAt).toBeInstanceOf(Date);
    });

    it('preserves exact approved PROPOSAL email snapshot representation without mutation', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch: ResendEmailFetchFn = async (_input, init) => {
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 're_msg_prop_01' })
        } as unknown as Response;
      };

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      const proposalInput: EmailOutreachProviderSendInput = {
        deliveryId: 'del-proposal-101',
        organizationId: 'org-test-01',
        channel: OutreachChannel.EMAIL,
        recipientNormalized: 'buyer@prospect.com',
        subject: 'Custom StoreMate Proposal',
        body: 'Here is the formal proposal for StoreMate integration.',
        providerIdempotencyToken: 'del-proposal-101'
      };

      await provider.send(proposalInput);
      const parsed = JSON.parse(capturedInit?.body as string);
      expect(parsed.subject).toBe('Custom StoreMate Proposal');
      expect(parsed.text).toBe('Here is the formal proposal for StoreMate integration.');
      expect(parsed.html).toBeUndefined();
    });

    it('preserves exact approved FOLLOW_UP email snapshot representation without mutation', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch: ResendEmailFetchFn = async (_input, init) => {
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 're_msg_followup_02' })
        } as unknown as Response;
      };

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      const followUpInput: EmailOutreachProviderSendInput = {
        deliveryId: 'del-followup-202',
        organizationId: 'org-test-01',
        channel: OutreachChannel.EMAIL,
        recipientNormalized: 'buyer@prospect.com',
        subject: 'Quick Follow-Up on Demo',
        body: 'Just checking in on our discussion from earlier this week.',
        providerIdempotencyToken: 'del-followup-202'
      };

      await provider.send(followUpInput);
      const parsed = JSON.parse(capturedInit?.body as string);
      expect(parsed.subject).toBe('Quick Follow-Up on Demo');
      expect(parsed.text).toBe('Just checking in on our discussion from earlier this week.');
      expect(parsed.html).toBeUndefined();
    });

    it('formats plain email from header when fromName is omitted', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch: ResendEmailFetchFn = async (_input, init) => {
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 're_msg_no_name' })
        } as unknown as Response;
      };

      const provider = new ResendEmailDeliveryProvider({
        config: { ...validConfig, fromName: undefined },
        fetchFn: mockFetch
      });

      await provider.send(validEmailInput);
      const parsedPayload = JSON.parse(capturedInit?.body as string);
      expect(parsedPayload.from).toBe('notifications@example.com');
    });

    it('falls back to "No Subject" when input subject is empty or null', async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch: ResendEmailFetchFn = async (_input, init) => {
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 're_msg_no_sub' })
        } as unknown as Response;
      };

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await provider.send({ ...validEmailInput, subject: null });
      const parsedPayload = JSON.parse(capturedInit?.body as string);
      expect(parsedPayload.subject).toBe('No Subject');
    });
  });

  describe('4. Success Response Validation', () => {
    it('throws INVALID_PROVIDER_RESPONSE if HTTP 200 response lacks id', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ message: 'success but no id field' })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE,
        retryable: false,
        safeMessage: expect.stringContaining('missing accepted message identifier')
      });
    });

    it('throws INVALID_PROVIDER_RESPONSE if HTTP 200 response body is malformed JSON', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('Unexpected token < in JSON');
          }
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE,
        retryable: false
      });
    });
  });

  describe('5. Timeout & Network Failure Taxonomy', () => {
    it('maps AbortController signal abort to PROVIDER_TIMEOUT (retryable)', async () => {
      const mockFetch: ResendEmailFetchFn = async (_input, init) => {
        const signal = init?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      };

      const provider = new ResendEmailDeliveryProvider({
        config: { ...validConfig, timeoutMs: 20 },
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.PROVIDER_TIMEOUT,
        retryable: true,
        safeMessage: 'Resend Email API connection timed out'
      });
    });

    it('maps network connection failure to PROVIDER_UNAVAILABLE (retryable)', async () => {
      const mockFetch: ResendEmailFetchFn = async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      };

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
        retryable: true,
        safeMessage: 'Resend Email API network transport failure'
      });
    });
  });

  describe('6. HTTP 409 Idempotency Conflict Handling', () => {
    it('maps HTTP 409 concurrent_idempotent_requests to PROVIDER_RATE_LIMITED (retryable: true)', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            statusCode: 409,
            name: 'concurrent_idempotent_requests',
            message: 'A request with this idempotency key is currently in progress.'
          })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.PROVIDER_RATE_LIMITED,
        retryable: true,
        safeMessage: expect.stringContaining('Concurrent Resend idempotent request in progress')
      });
    });

    it('maps HTTP 409 invalid_idempotent_request (different payload) to DELIVERY_FAILED (retryable: false)', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            statusCode: 409,
            name: 'invalid_idempotent_request',
            message: 'Idempotency key has already been used with different request parameters.'
          })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.DELIVERY_FAILED,
        retryable: false,
        safeMessage: expect.stringContaining('mismatched payload')
      });
    });
  });

  describe('7. Error Response Taxonomy & Secret Leak Prevention', () => {
    it('maps HTTP 429 to PROVIDER_RATE_LIMITED (retryable: true)', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: false,
          status: 429,
          json: async () => ({
            statusCode: 429,
            name: 'rate_limit_exceeded',
            message: 'Too many requests'
          })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.PROVIDER_RATE_LIMITED,
        retryable: true
      });
    });

    it('maps HTTP 5xx to PROVIDER_UNAVAILABLE (retryable: true)', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: false,
          status: 503,
          json: async () => ({ statusCode: 503, message: 'Service Unavailable' })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
        retryable: true
      });
    });

    it('maps HTTP 422 with recipient bounce error to RECIPIENT_REJECTED (retryable: false)', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: false,
          status: 422,
          json: async () => ({
            statusCode: 422,
            name: 'validation_error',
            message: 'The to email address is invalid or suppressed'
          })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.RECIPIENT_REJECTED,
        retryable: false
      });
    });

    it('maps HTTP 422 with spam / content error to CONTENT_REJECTED (retryable: false)', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: false,
          status: 422,
          json: async () => ({
            statusCode: 422,
            name: 'validation_error',
            message: 'Message blocked by spam filter policy'
          })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.CONTENT_REJECTED,
        retryable: false
      });
    });

    it('maps HTTP 422/403 with unverified domain to DELIVERY_FAILED (retryable: false)', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: false,
          status: 422,
          json: async () => ({
            statusCode: 422,
            name: 'validation_error',
            message: 'The domain example.com is not verified'
          })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      await expect(provider.send(validEmailInput)).rejects.toMatchObject({
        code: OutreachProviderErrorCode.DELIVERY_FAILED,
        retryable: false,
        safeMessage: 'Resend sender domain or from address verification failure'
      });
    });

    it('maps HTTP 401/403 bad API key to DELIVERY_FAILED without leaking API key', async () => {
      const mockFetch: ResendEmailFetchFn = async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({
            statusCode: 401,
            name: 'restricted_api_key',
            message: `Invalid API key ${validConfig.apiKey}`
          })
        } as unknown as Response);

      const provider = new ResendEmailDeliveryProvider({
        config: validConfig,
        fetchFn: mockFetch
      });

      try {
        await provider.send(validEmailInput);
        expect.unreachable('Should have thrown error');
      } catch (err: any) {
        expect(err).toBeInstanceOf(OutreachDeliveryProviderError);
        expect(err.code).toBe(OutreachProviderErrorCode.DELIVERY_FAILED);
        expect(err.retryable).toBe(false);
        expect(err.safeMessage).not.toContain(validConfig.apiKey);
        expect(err.safeMessage).toBe('Resend Email API authorization or configuration error');
      }
    });
  });
});
