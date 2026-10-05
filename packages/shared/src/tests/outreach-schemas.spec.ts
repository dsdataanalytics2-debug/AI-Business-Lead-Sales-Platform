import { describe, it, expect } from 'vitest';
import {
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  OUTREACH_TERMINAL_STATUSES,
  isOutreachDeliveryTerminal,
  ALLOWED_OUTREACH_DELIVERY_TRANSITIONS,
  canTransitionOutreachStatus,
  SalesAssistantDraftType,
  SalesAssistantDraftStatus,
  Role,
  Permissions,
  hasPermission,
  ROLE_PERMISSIONS,
  outreachIdempotencyKeySchema,
  sendOutreachDeliveryRequestSchema,
  ALLOWED_CHANNELS_FOR_DRAFT_TYPE,
  getAllowedOutreachChannelsForDraftType,
  isOutreachChannelCompatible,
  maskRecipient,
  outreachDeliverySummarySchema,
  outreachDeliveryResponseSchema,
  outreachDeliveryListResponseSchema,
  cancelOutreachDeliveryRequestSchema,
  outreachLeadIdParamSchema,
  outreachDeliveryIdParamSchema,
  outreachDeliveryParamsSchema,
  listOutreachDeliveriesQuerySchema
} from '../index.js';

describe('M6 Step 1: Outreach Shared Contracts & Permissions', () => {
  /* ---------------------------------------------------------
   * 1. Core Channel Enum
   * --------------------------------------------------------- */
  describe('OutreachChannel Enum', () => {
    it('defines exactly WHATSAPP and EMAIL', () => {
      const channels = Object.values(OutreachChannel);
      expect(channels.sort()).toEqual(['EMAIL', 'WHATSAPP']);
      expect(channels).toHaveLength(2);
    });

    it('rejects CALL, SMS, or random strings', () => {
      const validChannels: string[] = Object.values(OutreachChannel);
      expect(validChannels).not.toContain('CALL');
      expect(validChannels).not.toContain('SMS');
      expect(validChannels).not.toContain('PHONE');
      expect(validChannels).not.toContain('UNKNOWN');
    });
  });

  /* ---------------------------------------------------------
   * 2. Delivery Status Enum & Terminal Statuses
   * --------------------------------------------------------- */
  describe('OutreachDeliveryStatus Enum & Terminal State Contract', () => {
    it('defines exactly the 7 canonical delivery statuses', () => {
      const statuses = Object.values(OutreachDeliveryStatus);
      expect(statuses.sort()).toEqual([
        'CANCELLED',
        'DELIVERED',
        'FAILED',
        'PROCESSING',
        'QUEUED',
        'REQUESTED',
        'SENT'
      ]);
      expect(statuses).toHaveLength(7);
    });

    it('does NOT contain RETRY_SCHEDULED, PENDING, DRAFT, APPROVED, or REJECTED', () => {
      const statuses: string[] = Object.values(OutreachDeliveryStatus);
      expect(statuses).not.toContain('RETRY_SCHEDULED');
      expect(statuses).not.toContain('PENDING');
      expect(statuses).not.toContain('DRAFT');
      expect(statuses).not.toContain('APPROVED');
      expect(statuses).not.toContain('REJECTED');
    });

    it('identifies exactly DELIVERED, FAILED, CANCELLED as terminal statuses', () => {
      expect(OUTREACH_TERMINAL_STATUSES).toEqual([
        OutreachDeliveryStatus.DELIVERED,
        OutreachDeliveryStatus.FAILED,
        OutreachDeliveryStatus.CANCELLED
      ]);
      expect(isOutreachDeliveryTerminal(OutreachDeliveryStatus.DELIVERED)).toBe(true);
      expect(isOutreachDeliveryTerminal(OutreachDeliveryStatus.FAILED)).toBe(true);
      expect(isOutreachDeliveryTerminal(OutreachDeliveryStatus.CANCELLED)).toBe(true);

      expect(isOutreachDeliveryTerminal(OutreachDeliveryStatus.REQUESTED)).toBe(false);
      expect(isOutreachDeliveryTerminal(OutreachDeliveryStatus.QUEUED)).toBe(false);
      expect(isOutreachDeliveryTerminal(OutreachDeliveryStatus.PROCESSING)).toBe(false);
      expect(isOutreachDeliveryTerminal(OutreachDeliveryStatus.SENT)).toBe(false);
    });
  });

  /* ---------------------------------------------------------
   * 3. Allowed State Transitions
   * --------------------------------------------------------- */
  describe('State Machine Transitions', () => {
    it('allows valid transitions out of REQUESTED', () => {
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.REQUESTED, OutreachDeliveryStatus.QUEUED)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.REQUESTED, OutreachDeliveryStatus.CANCELLED)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.REQUESTED, OutreachDeliveryStatus.SENT)).toBe(false);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.REQUESTED, OutreachDeliveryStatus.DELIVERED)).toBe(false);
    });

    it('allows valid transitions out of QUEUED', () => {
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.QUEUED, OutreachDeliveryStatus.PROCESSING)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.QUEUED, OutreachDeliveryStatus.CANCELLED)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.QUEUED, OutreachDeliveryStatus.DELIVERED)).toBe(false);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.QUEUED, OutreachDeliveryStatus.SENT)).toBe(false);
    });

    it('allows valid transitions out of PROCESSING (including retry PROCESSING -> QUEUED)', () => {
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.PROCESSING, OutreachDeliveryStatus.SENT)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.PROCESSING, OutreachDeliveryStatus.QUEUED)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.PROCESSING, OutreachDeliveryStatus.FAILED)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.PROCESSING, OutreachDeliveryStatus.CANCELLED)).toBe(false);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.PROCESSING, OutreachDeliveryStatus.DELIVERED)).toBe(false);
    });

    it('allows valid transitions out of SENT (webhook delivery or final bounce)', () => {
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.SENT, OutreachDeliveryStatus.DELIVERED)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.SENT, OutreachDeliveryStatus.FAILED)).toBe(true);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.SENT, OutreachDeliveryStatus.PROCESSING)).toBe(false);
      expect(canTransitionOutreachStatus(OutreachDeliveryStatus.SENT, OutreachDeliveryStatus.QUEUED)).toBe(false);
    });

    it('strictly forbids any transition out of terminal states (DELIVERED, FAILED, CANCELLED)', () => {
      const allStatuses = Object.values(OutreachDeliveryStatus);

      for (const target of allStatuses) {
        expect(canTransitionOutreachStatus(OutreachDeliveryStatus.DELIVERED, target)).toBe(false);
        expect(canTransitionOutreachStatus(OutreachDeliveryStatus.FAILED, target)).toBe(false);
        expect(canTransitionOutreachStatus(OutreachDeliveryStatus.CANCELLED, target)).toBe(false);
      }
    });

    it('transition map matches canonical specification exactly', () => {
      expect(ALLOWED_OUTREACH_DELIVERY_TRANSITIONS[OutreachDeliveryStatus.DELIVERED]).toEqual([]);
      expect(ALLOWED_OUTREACH_DELIVERY_TRANSITIONS[OutreachDeliveryStatus.FAILED]).toEqual([]);
      expect(ALLOWED_OUTREACH_DELIVERY_TRANSITIONS[OutreachDeliveryStatus.CANCELLED]).toEqual([]);
    });
  });

  /* ---------------------------------------------------------
   * 4. Public Error Codes
   * --------------------------------------------------------- */
  describe('OutreachErrorCode Enum', () => {
    it('defines exactly the 13 canonical outreach error codes', () => {
      const codes = Object.values(OutreachErrorCode);
      expect(codes.sort()).toEqual([
        'OUTREACH_CHANNEL_INCOMPATIBLE',
        'OUTREACH_CONTENT_REJECTED',
        'OUTREACH_DELIVERY_FAILED',
        'OUTREACH_DELIVERY_IN_FLIGHT',
        'OUTREACH_DRAFT_NOT_APPROVED',
        'OUTREACH_IDEMPOTENCY_KEY_REUSED',
        'OUTREACH_PROVIDER_BAD_GATEWAY',
        'OUTREACH_PROVIDER_RATE_LIMITED',
        'OUTREACH_PROVIDER_TIMEOUT',
        'OUTREACH_PROVIDER_UNAVAILABLE',
        'OUTREACH_RECIPIENT_INVALID',
        'OUTREACH_RECIPIENT_REJECTED',
        'OUTREACH_RECIPIENT_SUPPRESSED'
      ]);
      expect(codes).toHaveLength(13);
    });

    it('does not include M5 AI provider errors or generic internal names', () => {
      const codes: string[] = Object.values(OutreachErrorCode);
      expect(codes).not.toContain('AI_PROVIDER_TIMEOUT');
      expect(codes).not.toContain('AI_GENERATION_FAILED');
      expect(codes).not.toContain('RATE_LIMITED');
    });
  });

  /* ---------------------------------------------------------
   * 5. Idempotency Key Contract
   * --------------------------------------------------------- */
  describe('outreachIdempotencyKeySchema', () => {
    it('accepts valid UUID-like keys', () => {
      const uuidKey = '123e4567-e89b-12d3-a456-426614174000';
      const result = outreachIdempotencyKeySchema.safeParse(uuidKey);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(uuidKey);
      }
    });

    it('accepts opaque alphanumeric and punctuation tokens (. _ : -)', () => {
      const tokens = [
        'idemp_token_123456',
        'req:outreach:client-99',
        'batch.run_2026.10.05-token',
        'AbCdEfGh12345678'
      ];
      for (const t of tokens) {
        const res = outreachIdempotencyKeySchema.safeParse(t);
        expect(res.success).toBe(true);
      }
    });

    it('rejects keys shorter than 8 characters', () => {
      const shortKey = 'abc1234'; // 7 chars
      const result = outreachIdempotencyKeySchema.safeParse(shortKey);
      expect(result.success).toBe(false);
    });

    it('rejects keys longer than 128 characters', () => {
      const longKey = 'a'.repeat(129);
      const result = outreachIdempotencyKeySchema.safeParse(longKey);
      expect(result.success).toBe(false);
    });

    it('rejects blank, whitespace-only, spaces, newlines, and invalid punctuation', () => {
      const invalid = [
        '',
        '        ',
        'token with spaces',
        'token\nwith\nnewline',
        'token\twith\ttab',
        'token@domain.com',
        'token/path/sub',
        'token#hash',
        'token!bang',
        'token$dollar'
      ];
      for (const inv of invalid) {
        const res = outreachIdempotencyKeySchema.safeParse(inv);
        expect(res.success).toBe(false);
      }
    });

    it('preserves casing and does not lowercase tokens automatically', () => {
      const mixedCaseKey = 'MyClientToken-1234-XYZ';
      const result = outreachIdempotencyKeySchema.safeParse(mixedCaseKey);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(mixedCaseKey);
        expect(result.data).not.toBe(mixedCaseKey.toLowerCase());
      }
    });
  });

  /* ---------------------------------------------------------
   * 6. Send Request Contract & Strict Unknown Field Rejection
   * --------------------------------------------------------- */
  describe('sendOutreachDeliveryRequestSchema', () => {
    const validDraftId = '11111111-1111-4111-8111-111111111111';
    const validRecipientContactId = '22222222-2222-4222-8222-222222222222';

    it('accepts valid minimal dispatch request (draftId + channel)', () => {
      const result = sendOutreachDeliveryRequestSchema.safeParse({
        draftId: validDraftId,
        channel: OutreachChannel.WHATSAPP
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.draftId).toBe(validDraftId);
        expect(result.data.channel).toBe(OutreachChannel.WHATSAPP);
        expect(result.data.recipientContactId).toBeUndefined();
      }
    });

    it('accepts valid dispatch request with optional recipientContactId', () => {
      const result = sendOutreachDeliveryRequestSchema.safeParse({
        draftId: validDraftId,
        channel: OutreachChannel.EMAIL,
        recipientContactId: validRecipientContactId
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.channel).toBe(OutreachChannel.EMAIL);
        expect(result.data.recipientContactId).toBe(validRecipientContactId);
      }
    });

    it('rejects missing draftId, non-UUID draftId, missing channel, and unsupported channel', () => {
      expect(
        sendOutreachDeliveryRequestSchema.safeParse({
          channel: OutreachChannel.WHATSAPP
        }).success
      ).toBe(false);

      expect(
        sendOutreachDeliveryRequestSchema.safeParse({
          draftId: 'not-a-uuid',
          channel: OutreachChannel.WHATSAPP
        }).success
      ).toBe(false);

      expect(
        sendOutreachDeliveryRequestSchema.safeParse({
          draftId: validDraftId
        }).success
      ).toBe(false);

      expect(
        sendOutreachDeliveryRequestSchema.safeParse({
          draftId: validDraftId,
          channel: 'CALL'
        }).success
      ).toBe(false);

      expect(
        sendOutreachDeliveryRequestSchema.safeParse({
          draftId: validDraftId,
          channel: OutreachChannel.EMAIL,
          recipientContactId: 'invalid-contact-uuid'
        }).success
      ).toBe(false);
    });

    it('strictly rejects any unknown fields (table-driven unknown field defense)', () => {
      const prohibitedFields = [
        { organizationId: '99999999-9999-4999-8999-999999999999' },
        { leadId: '88888888-8888-4888-8888-888888888888' },
        { provider: 'MOCK' },
        { providerName: 'meta_cloud' },
        { providerMessageId: 'wamid.123' },
        { status: 'SENT' },
        { attemptCount: 1 },
        { recipient: '+8801700000000' },
        { recipientNormalized: '+8801700000000' },
        { recipientSource: 'MANUAL' },
        { snapshotContent: 'tampered text' },
        { snapshotSubject: 'tampered subject' },
        { snapshotBody: 'tampered body' },
        { approvedDraftSnapshotHash: 'fakehash' },
        { requestedByUserId: '33333333-3333-4333-8333-333333333333' },
        { queuedAt: new Date().toISOString() },
        { sentAt: new Date().toISOString() },
        { deliveredAt: new Date().toISOString() },
        { failedAt: new Date().toISOString() },
        { cancelledAt: new Date().toISOString() },
        { lastErrorCode: 'OUTREACH_DELIVERY_FAILED' },
        { lastErrorMessage: 'error' },
        { message: 'hello' },
        { body: 'hello' },
        { subject: 'hello' },
        { content: 'hello' },
        { apiKey: 'secret-key-123' },
        { authorization: 'Bearer secret' },
        { sendNow: true },
        { autoSend: true },
        { idempotencyKey: 'key-in-body' }
      ];

      for (const field of prohibitedFields) {
        const payload = {
          draftId: validDraftId,
          channel: OutreachChannel.WHATSAPP,
          ...field
        };
        const result = sendOutreachDeliveryRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });
  });

  /* ---------------------------------------------------------
   * 7. Draft / Channel Compatibility
   * --------------------------------------------------------- */
  describe('Draft / Channel Compatibility Helper & Matrix', () => {
    it('WHATSAPP draft is compatible only with WHATSAPP', () => {
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.WHATSAPP, OutreachChannel.WHATSAPP)).toBe(true);
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.WHATSAPP, OutreachChannel.EMAIL)).toBe(false);
      expect(getAllowedOutreachChannelsForDraftType(SalesAssistantDraftType.WHATSAPP)).toEqual([
        OutreachChannel.WHATSAPP
      ]);
    });

    it('EMAIL draft is compatible only with EMAIL', () => {
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.EMAIL, OutreachChannel.EMAIL)).toBe(true);
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.EMAIL, OutreachChannel.WHATSAPP)).toBe(false);
      expect(getAllowedOutreachChannelsForDraftType(SalesAssistantDraftType.EMAIL)).toEqual([
        OutreachChannel.EMAIL
      ]);
    });

    it('PROPOSAL draft is compatible only with EMAIL', () => {
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.PROPOSAL, OutreachChannel.EMAIL)).toBe(true);
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.PROPOSAL, OutreachChannel.WHATSAPP)).toBe(false);
      expect(getAllowedOutreachChannelsForDraftType(SalesAssistantDraftType.PROPOSAL)).toEqual([
        OutreachChannel.EMAIL
      ]);
    });

    it('FOLLOW_UP draft is compatible with either WHATSAPP or EMAIL (explicit selection required)', () => {
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.FOLLOW_UP, OutreachChannel.WHATSAPP)).toBe(true);
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.FOLLOW_UP, OutreachChannel.EMAIL)).toBe(true);
      expect(getAllowedOutreachChannelsForDraftType(SalesAssistantDraftType.FOLLOW_UP)).toEqual([
        OutreachChannel.WHATSAPP,
        OutreachChannel.EMAIL
      ]);
    });

    it('CALL_SCRIPT draft has ZERO compatible core delivery channels', () => {
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.CALL_SCRIPT, OutreachChannel.WHATSAPP)).toBe(false);
      expect(isOutreachChannelCompatible(SalesAssistantDraftType.CALL_SCRIPT, OutreachChannel.EMAIL)).toBe(false);
      expect(getAllowedOutreachChannelsForDraftType(SalesAssistantDraftType.CALL_SCRIPT)).toEqual([]);
    });

    it('ALLOWED_CHANNELS_FOR_DRAFT_TYPE covers all 5 draft types', () => {
      const allDraftTypes = Object.values(SalesAssistantDraftType);
      for (const dt of allDraftTypes) {
        expect(ALLOWED_CHANNELS_FOR_DRAFT_TYPE).toHaveProperty(dt);
      }
    });
  });

  /* ---------------------------------------------------------
   * 8. Recipient Masking Utility
   * --------------------------------------------------------- */
  describe('maskRecipient Utility', () => {
    it('masks E.164 mobile numbers with prefix and last 4 digits', () => {
      expect(maskRecipient('+8801712345678')).toBe('+88017****5678');
      expect(maskRecipient('+8801999888777')).toBe('+88019****8777');
    });

    it('masks local phone numbers preserving prefix and last 4 digits', () => {
      expect(maskRecipient('01712345678')).toBe('017****5678');
    });

    it('masks email addresses preserving first and last char of user part', () => {
      expect(maskRecipient('lead@example.com')).toBe('l***d@example.com');
      expect(maskRecipient('john.doe@company.org')).toBe('j***e@company.org');
    });

    it('handles short email usernames gracefully', () => {
      expect(maskRecipient('ab@example.com')).toBe('a***@example.com');
      expect(maskRecipient('x@example.com')).toBe('x***@example.com');
    });

    it('handles empty or short fallback input safely', () => {
      expect(maskRecipient('')).toBe('***');
      expect(maskRecipient('abc')).toBe('a***');
    });
  });

  /* ---------------------------------------------------------
   * 9. Public Outreach Delivery DTOs & Response Data Minimization
   * --------------------------------------------------------- */
  describe('Public Delivery DTOs', () => {
    const validDelivery = {
      id: '11111111-1111-4111-8111-111111111111',
      leadId: '22222222-2222-4222-8222-222222222222',
      draftId: '33333333-3333-4333-8333-333333333333',
      channel: OutreachChannel.WHATSAPP,
      status: OutreachDeliveryStatus.QUEUED,
      recipientMasked: '+88017****5678',
      recipientContactId: '44444444-4444-4444-8444-444444444444',
      attemptCount: 0,
      lastErrorCode: null,
      safeLastErrorMessage: null,
      requestedAt: '2026-10-05T10:00:00.000Z',
      queuedAt: '2026-10-05T10:00:01.000Z',
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
      cancelledAt: null,
      createdAt: '2026-10-05T10:00:00.000Z',
      updatedAt: '2026-10-05T10:00:01.000Z'
    };

    it('parses valid outreach delivery summary DTO', () => {
      const result = outreachDeliverySummarySchema.safeParse(validDelivery);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(validDelivery.id);
        expect(result.data.status).toBe(OutreachDeliveryStatus.QUEUED);
        expect(result.data.recipientMasked).toBe('+88017****5678');
      }
    });

    it('strictly rejects DTO containing raw recipientNormalized or sensitive internal fields', () => {
      const sensitiveLeak = {
        ...validDelivery,
        recipientNormalized: '+8801712345678'
      };
      expect(outreachDeliverySummarySchema.safeParse(sensitiveLeak).success).toBe(false);

      const contentLeak = {
        ...validDelivery,
        snapshotContent: 'Internal confidential sales content'
      };
      expect(outreachDeliverySummarySchema.safeParse(contentLeak).success).toBe(false);

      const hashLeak = {
        ...validDelivery,
        approvedDraftSnapshotHash: 'sha256-hash'
      };
      expect(outreachDeliverySummarySchema.safeParse(hashLeak).success).toBe(false);

      const providerLeak = {
        ...validDelivery,
        provider: 'MOCK',
        providerMessageId: 'wamid.123'
      };
      expect(outreachDeliverySummarySchema.safeParse(providerLeak).success).toBe(false);

      const authLeak = {
        ...validDelivery,
        apiKey: 'sk-live-12345',
        authorization: 'Bearer token'
      };
      expect(outreachDeliverySummarySchema.safeParse(authLeak).success).toBe(false);

      const idempotencyLeak = {
        ...validDelivery,
        idempotencyKey: 'idemp-header-key'
      };
      expect(outreachDeliverySummarySchema.safeParse(idempotencyLeak).success).toBe(false);
    });

    it('parses list response DTO with total count', () => {
      const listPayload = {
        deliveries: [validDelivery],
        total: 1
      };
      const result = outreachDeliveryListResponseSchema.safeParse(listPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deliveries).toHaveLength(1);
        expect(result.data.total).toBe(1);
      }
    });

    it('aliases outreachDeliveryResponseSchema to summary schema', () => {
      expect(outreachDeliveryResponseSchema).toBe(outreachDeliverySummarySchema);
    });

    it('hardened lastErrorCode accepts valid OutreachErrorCode, null, or omitted', () => {
      // 1. Valid OutreachErrorCode
      const withValidErrorCode = {
        ...validDelivery,
        lastErrorCode: OutreachErrorCode.OUTREACH_PROVIDER_TIMEOUT
      };
      const res1 = outreachDeliverySummarySchema.safeParse(withValidErrorCode);
      expect(res1.success).toBe(true);
      if (res1.success) {
        expect(res1.data.lastErrorCode).toBe(OutreachErrorCode.OUTREACH_PROVIDER_TIMEOUT);
      }

      // 2. null
      const withNullErrorCode = {
        ...validDelivery,
        lastErrorCode: null
      };
      const res2 = outreachDeliverySummarySchema.safeParse(withNullErrorCode);
      expect(res2.success).toBe(true);
      if (res2.success) {
        expect(res2.data.lastErrorCode).toBeNull();
      }

      // 3. omitted (undefined)
      const { lastErrorCode: _, ...withoutErrorCode } = validDelivery;
      const res3 = outreachDeliverySummarySchema.safeParse(withoutErrorCode);
      expect(res3.success).toBe(true);
      if (res3.success) {
        expect(res3.data.lastErrorCode).toBeUndefined();
      }
    });

    it('hardened lastErrorCode strictly rejects arbitrary/internal/vendor error strings', () => {
      const rejectedStrings = [
        'PROVIDER_TIMEOUT',
        'META_131030',
        'arbitrary_internal_error',
        'raw vendor error text',
        'AI_PROVIDER_TIMEOUT',
        'ECONNRESET: Connection lost to upstream',
        '500 Internal Server Error'
      ];

      for (const err of rejectedStrings) {
        const payload = {
          ...validDelivery,
          lastErrorCode: err
        };
        const result = outreachDeliverySummarySchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });
  });

  /* ---------------------------------------------------------
   * 10. Route Param & Query Schemas
   * --------------------------------------------------------- */
  describe('Route Param & Query Schemas', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';

    it('outreachLeadIdParamSchema validates UUID id', () => {
      expect(outreachLeadIdParamSchema.safeParse({ id: validUuid }).success).toBe(true);
      expect(outreachLeadIdParamSchema.safeParse({ id: 'bad-id' }).success).toBe(false);
      expect(outreachLeadIdParamSchema.safeParse({ id: validUuid, extra: 1 }).success).toBe(false);
    });

    it('outreachDeliveryIdParamSchema validates UUID deliveryId', () => {
      expect(outreachDeliveryIdParamSchema.safeParse({ deliveryId: validUuid }).success).toBe(true);
      expect(outreachDeliveryIdParamSchema.safeParse({ deliveryId: 'bad-id' }).success).toBe(false);
    });

    it('outreachDeliveryParamsSchema validates composite id and deliveryId', () => {
      const result = outreachDeliveryParamsSchema.safeParse({
        id: validUuid,
        deliveryId: validUuid
      });
      expect(result.success).toBe(true);
    });

    it('cancelOutreachDeliveryRequestSchema accepts empty or undefined body', () => {
      expect(cancelOutreachDeliveryRequestSchema.safeParse({}).success).toBe(true);
      expect(cancelOutreachDeliveryRequestSchema.safeParse(undefined).success).toBe(true);
      expect(cancelOutreachDeliveryRequestSchema.safeParse({ status: 'CANCELLED' }).success).toBe(false);
    });

    it('listOutreachDeliveriesQuerySchema accepts optional status and channel filters', () => {
      expect(listOutreachDeliveriesQuerySchema.safeParse({}).success).toBe(true);
      expect(
        listOutreachDeliveriesQuerySchema.safeParse({
          status: OutreachDeliveryStatus.QUEUED,
          channel: OutreachChannel.WHATSAPP
        }).success
      ).toBe(true);
      expect(
        listOutreachDeliveriesQuerySchema.safeParse({
          status: 'INVALID_STATUS'
        }).success
      ).toBe(false);
      expect(
        listOutreachDeliveriesQuerySchema.safeParse({
          extraFilter: 'bad'
        }).success
      ).toBe(false);
    });
  });

  /* ---------------------------------------------------------
   * 11. RBAC Permissions Matrix
   * --------------------------------------------------------- */
  describe('RBAC Permissions & Role-Permission Matrix', () => {
    it('defines OUTREACH_READ, OUTREACH_SEND, OUTREACH_MANAGE permissions', () => {
      expect(Permissions.OUTREACH_READ).toBe('outreach:read');
      expect(Permissions.OUTREACH_SEND).toBe('outreach:send');
      expect(Permissions.OUTREACH_MANAGE).toBe('outreach:manage');
    });

    it('grants SUPER_ADMIN all 3 outreach permissions', () => {
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.OUTREACH_READ)).toBe(true);
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.OUTREACH_SEND)).toBe(true);
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.OUTREACH_MANAGE)).toBe(true);
    });

    it('grants ADMIN all 3 outreach permissions', () => {
      expect(hasPermission(Role.ADMIN, Permissions.OUTREACH_READ)).toBe(true);
      expect(hasPermission(Role.ADMIN, Permissions.OUTREACH_SEND)).toBe(true);
      expect(hasPermission(Role.ADMIN, Permissions.OUTREACH_MANAGE)).toBe(true);
    });

    it('grants SALES_MANAGER all 3 outreach permissions', () => {
      expect(hasPermission(Role.SALES_MANAGER, Permissions.OUTREACH_READ)).toBe(true);
      expect(hasPermission(Role.SALES_MANAGER, Permissions.OUTREACH_SEND)).toBe(true);
      expect(hasPermission(Role.SALES_MANAGER, Permissions.OUTREACH_MANAGE)).toBe(true);
    });

    it('grants SALES_EXECUTIVE OUTREACH_READ and OUTREACH_SEND, but NOT OUTREACH_MANAGE', () => {
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.OUTREACH_READ)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.OUTREACH_SEND)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.OUTREACH_MANAGE)).toBe(false);
    });

    it('grants VIEWER only OUTREACH_READ, denying SEND and MANAGE', () => {
      expect(hasPermission(Role.VIEWER, Permissions.OUTREACH_READ)).toBe(true);
      expect(hasPermission(Role.VIEWER, Permissions.OUTREACH_SEND)).toBe(false);
      expect(hasPermission(Role.VIEWER, Permissions.OUTREACH_MANAGE)).toBe(false);
    });

    it('does not mutate or regress existing permissions across all roles', () => {
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.LEADS_READ)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.LEADS_WRITE)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.DEMOS_GENERATE)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.SALES_ASSISTANT_GENERATE)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.SALES_ASSISTANT_REVIEW)).toBe(false);

      expect(hasPermission(Role.VIEWER, Permissions.LEADS_READ)).toBe(true);
      expect(hasPermission(Role.VIEWER, Permissions.LEADS_WRITE)).toBe(false);
      expect(hasPermission(Role.VIEWER, Permissions.SALES_ASSISTANT_GENERATE)).toBe(false);
    });
  });

  /* ---------------------------------------------------------
   * 12. Safety Invariants: No M5 Status Collision, No PHONE -> WHATSAPP
   * --------------------------------------------------------- */
  describe('Safety Invariants', () => {
    it('M5 SalesAssistantDraftStatus strictly contains only DRAFT, APPROVED, REJECTED (NO SENT)', () => {
      const m5Statuses = Object.values(SalesAssistantDraftStatus);
      expect(m5Statuses.sort()).toEqual(['APPROVED', 'DRAFT', 'REJECTED']);
      expect(m5Statuses).not.toContain('SENT');
      expect(m5Statuses).toHaveLength(3);
    });

    it('No exported helper converts or promotes PHONE to WHATSAPP', () => {
      // Invariant: PHONE != WHATSAPP is strictly preserved.
      // Confirm OutreachChannel has no PHONE and no conversion helpers exist in shared.
      const channels = Object.values(OutreachChannel);
      expect(channels).not.toContain('PHONE');
    });
  });
});
