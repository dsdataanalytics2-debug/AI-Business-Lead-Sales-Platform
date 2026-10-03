import { describe, it, expect } from 'vitest';
import {
  DemoWebsiteStatus,
  DEMO_WEBSITE_STATUS_LABELS,
  ORDERED_DEMO_WEBSITE_STATUSES,
  getDemoWebsiteStatusLabel,
  isValidDemoWebsiteTransition,
  DemoWebsiteProvider,
  DemoWebsiteErrorCode,
  createDemoWebsiteRequestSchema,
  demoWebsiteSummarySchema,
  demoWebsiteResponseSchema,
  storemateOutboundPayloadSchema
} from '../index.js';

describe('M4 Step 1: StoreMate Demo Website Integration Contracts', () => {
  /* -----------------------------------------------------------------
   * 1. Canonical Demo Website Statuses & Constants
   * ----------------------------------------------------------------- */
  describe('Canonical DemoWebsiteStatus Enum & Lifecycle', () => {
    it('1. Exactly the 6 canonical statuses are defined in DemoWebsiteStatus enum', () => {
      const expectedStatuses = ['REQUESTED', 'CREATING', 'READY', 'FAILED', 'EXPIRED', 'REMOVED'];
      const actualStatuses = Object.values(DemoWebsiteStatus);
      expect(actualStatuses).toEqual(expectedStatuses);
      expect(actualStatuses).toHaveLength(6);
    });

    it('2. Status labels and ordered list match canonical specifications', () => {
      expect(DEMO_WEBSITE_STATUS_LABELS[DemoWebsiteStatus.REQUESTED]).toBe('Requested');
      expect(DEMO_WEBSITE_STATUS_LABELS[DemoWebsiteStatus.CREATING]).toBe('Creating');
      expect(DEMO_WEBSITE_STATUS_LABELS[DemoWebsiteStatus.READY]).toBe('Ready');
      expect(DEMO_WEBSITE_STATUS_LABELS[DemoWebsiteStatus.FAILED]).toBe('Failed');
      expect(DEMO_WEBSITE_STATUS_LABELS[DemoWebsiteStatus.EXPIRED]).toBe('Expired');
      expect(DEMO_WEBSITE_STATUS_LABELS[DemoWebsiteStatus.REMOVED]).toBe('Removed');

      expect(getDemoWebsiteStatusLabel(DemoWebsiteStatus.READY)).toBe('Ready');

      expect(ORDERED_DEMO_WEBSITE_STATUSES).toEqual([
        DemoWebsiteStatus.REQUESTED,
        DemoWebsiteStatus.CREATING,
        DemoWebsiteStatus.READY,
        DemoWebsiteStatus.FAILED,
        DemoWebsiteStatus.EXPIRED,
        DemoWebsiteStatus.REMOVED
      ]);
    });

    it('3. Lifecycle transition validator enforces valid transitions and rejects illegal jumps', () => {
      // Valid transitions
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.REQUESTED, DemoWebsiteStatus.CREATING)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.CREATING, DemoWebsiteStatus.READY)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.CREATING, DemoWebsiteStatus.FAILED)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.READY, DemoWebsiteStatus.EXPIRED)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.READY, DemoWebsiteStatus.REMOVED)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.FAILED, DemoWebsiteStatus.REQUESTED)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.EXPIRED, DemoWebsiteStatus.REQUESTED)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.EXPIRED, DemoWebsiteStatus.REMOVED)).toBe(true);

      // Illegal transitions
      // EXPIRED cannot silently jump to READY without new creation
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.EXPIRED, DemoWebsiteStatus.READY)).toBe(false);
      // REMOVED is terminal
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.REMOVED, DemoWebsiteStatus.REQUESTED)).toBe(false);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.REMOVED, DemoWebsiteStatus.READY)).toBe(false);
      // REQUESTED cannot jump directly to READY without CREATING
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.REQUESTED, DemoWebsiteStatus.READY)).toBe(false);
    });
  });

  /* -----------------------------------------------------------------
   * 2. Providers & Error Codes
   * ----------------------------------------------------------------- */
  describe('Providers and Error Codes', () => {
    it('4. Defines STOREMATE and MOCK providers', () => {
      expect(Object.values(DemoWebsiteProvider)).toEqual(['STOREMATE', 'MOCK']);
    });

    it('5. Defines safe, standardized internal error codes', () => {
      expect(DemoWebsiteErrorCode.STOREMATE_TIMEOUT).toBe('STOREMATE_TIMEOUT');
      expect(DemoWebsiteErrorCode.STOREMATE_UNAVAILABLE).toBe('STOREMATE_UNAVAILABLE');
      expect(DemoWebsiteErrorCode.STOREMATE_INVALID_RESPONSE).toBe('STOREMATE_INVALID_RESPONSE');
      expect(DemoWebsiteErrorCode.STOREMATE_AUTH_FAILED).toBe('STOREMATE_AUTH_FAILED');
      expect(DemoWebsiteErrorCode.STOREMATE_RATE_LIMITED).toBe('STOREMATE_RATE_LIMITED');
      expect(DemoWebsiteErrorCode.PAYLOAD_VALIDATION_FAILED).toBe('PAYLOAD_VALIDATION_FAILED');
      expect(DemoWebsiteErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });
  });

  /* -----------------------------------------------------------------
   * 3. createDemoWebsiteRequestSchema
   * ----------------------------------------------------------------- */
  describe('createDemoWebsiteRequestSchema', () => {
    it('6. Accepts empty object with default template key', () => {
      const result = createDemoWebsiteRequestSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.templateKey).toBe('generic-local-business');
      }
    });

    it('7. Accepts valid custom headline and description', () => {
      const input = {
        templateKey: 'generic-local-business',
        customHeadline: 'Premium Dental Care in Dhaka',
        customDescription: 'Providing world-class oral healthcare with modern equipment.'
      };
      const result = createDemoWebsiteRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customHeadline).toBe('Premium Dental Care in Dhaka');
        expect(result.data.customDescription).toBe('Providing world-class oral healthcare with modern equipment.');
      }
    });

    it('8. Transforms empty strings in headline/description to null', () => {
      const input = {
        customHeadline: '   ',
        customDescription: ''
      };
      const result = createDemoWebsiteRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customHeadline).toBeNull();
        expect(result.data.customDescription).toBeNull();
      }
    });

    it('9. Strictly rejects unknown extra fields', () => {
      const input = {
        templateKey: 'generic-local-business',
        unauthorizedSecret: 'fake-secret'
      };
      const result = createDemoWebsiteRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('10. Enforces max length limits on custom inputs', () => {
      const inputLongHeadline = {
        customHeadline: 'A'.repeat(201)
      };
      expect(createDemoWebsiteRequestSchema.safeParse(inputLongHeadline).success).toBe(false);

      const inputLongDesc = {
        customDescription: 'A'.repeat(2001)
      };
      expect(createDemoWebsiteRequestSchema.safeParse(inputLongDesc).success).toBe(false);
    });
  });

  /* -----------------------------------------------------------------
   * 4. demoWebsiteSummarySchema & demoWebsiteResponseSchema
   * ----------------------------------------------------------------- */
  describe('demoWebsiteSummarySchema & demoWebsiteResponseSchema', () => {
    const validSummary = {
      id: 'a0000000-0000-0000-0000-000000000001',
      leadId: 'b0000000-0000-0000-0000-000000000001',
      organizationId: 'c0000000-0000-0000-0000-000000000001',
      status: DemoWebsiteStatus.READY,
      provider: DemoWebsiteProvider.STOREMATE,
      providerSiteId: 'sm_site_998877',
      demoUrl: 'https://demo-abc-dentistry.storemate.cloud',
      requestedByUserId: 'd0000000-0000-0000-0000-000000000001',
      requestedByUser: {
        id: 'd0000000-0000-0000-0000-000000000001',
        name: 'Sales Rep Alice',
        email: 'alice@example.com'
      },
      readyAt: '2026-10-03T10:00:00.000Z',
      expiresAt: '2026-10-17T10:00:00.000Z',
      lastErrorCode: null,
      lastErrorMessageSafe: null,
      createdAt: '2026-10-03T09:55:00.000Z',
      updatedAt: '2026-10-03T10:00:00.000Z'
    };

    it('11. Validates complete ready demo summary successfully', () => {
      const result = demoWebsiteSummarySchema.safeParse(validSummary);
      expect(result.success).toBe(true);
      expect(demoWebsiteResponseSchema.safeParse(validSummary).success).toBe(true);
    });

    it('12. Accepts nullable/omitted optional fields for in-progress demo', () => {
      const inProgressSummary = {
        id: 'a0000000-0000-0000-0000-000000000001',
        leadId: 'b0000000-0000-0000-0000-000000000001',
        organizationId: 'c0000000-0000-0000-0000-000000000001',
        status: DemoWebsiteStatus.CREATING,
        provider: DemoWebsiteProvider.MOCK,
        providerSiteId: null,
        demoUrl: null,
        requestedByUserId: 'd0000000-0000-0000-0000-000000000001',
        readyAt: null,
        expiresAt: null,
        lastErrorCode: null,
        lastErrorMessageSafe: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const result = demoWebsiteSummarySchema.safeParse(inProgressSummary);
      expect(result.success).toBe(true);
    });

    it('13. Validates safe error recording on failed demo', () => {
      const failedSummary = {
        ...validSummary,
        status: DemoWebsiteStatus.FAILED,
        demoUrl: null,
        lastErrorCode: DemoWebsiteErrorCode.STOREMATE_TIMEOUT,
        lastErrorMessageSafe: 'StoreMate service timeout during page provisioning'
      };
      const result = demoWebsiteSummarySchema.safeParse(failedSummary);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lastErrorCode).toBe('STOREMATE_TIMEOUT');
        expect(result.data.lastErrorMessageSafe).toBe('StoreMate service timeout during page provisioning');
      }
    });

    it('14. Strictly rejects unknown extra fields or invalid demoUrl format', () => {
      const invalidUrl = {
        ...validSummary,
        demoUrl: 'not-a-valid-url'
      };
      expect(demoWebsiteSummarySchema.safeParse(invalidUrl).success).toBe(false);

      const withSecret = {
        ...validSummary,
        providerSecretToken: 'raw_secret_key_should_never_leak'
      };
      expect(demoWebsiteSummarySchema.safeParse(withSecret).success).toBe(false);
    });
  });

  /* -----------------------------------------------------------------
   * 5. storemateOutboundPayloadSchema (Outbound Invariants)
   * ----------------------------------------------------------------- */
  describe('storemateOutboundPayloadSchema & Outbound Invariants', () => {
    const validOutboundPayload = {
      business: {
        name: 'Dhaka Premium Bakery',
        category: 'Bakery & Confectionery',
        description: 'Artisan sourdough and sweet pastries baked fresh daily.'
      },
      contact: {
        phone: '+8801700000001',
        email: 'info@dhakabakery.com',
        address: 'Banani, Dhaka, Bangladesh'
      },
      branding: {
        logoUrl: 'https://cdn.example.com/logos/bakery.png',
        coverImageUrl: 'https://cdn.example.com/covers/bakery-shop.jpg'
      },
      social: {
        facebook: 'https://facebook.com/dhakabakery',
        instagram: 'https://instagram.com/dhakabakery',
        whatsapp: '+8801700000001'
      },
      metadata: {
        leadId: 'a0000000-0000-0000-0000-000000000001',
        organizationId: 'b0000000-0000-0000-0000-000000000001',
        templateKey: 'generic-local-business',
        isDemo: true as const,
        noindex: true as const,
        nofollow: true as const
      }
    };

    it('15. Validates complete outbound payload with all invariants', () => {
      const result = storemateOutboundPayloadSchema.safeParse(validOutboundPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.isDemo).toBe(true);
        expect(result.data.metadata.noindex).toBe(true);
        expect(result.data.metadata.nofollow).toBe(true);
      }
    });

    it('16. Invariant enforcement: isDemo MUST be true', () => {
      const payloadFalseDemo = {
        ...validOutboundPayload,
        metadata: {
          ...validOutboundPayload.metadata,
          isDemo: false
        }
      };
      const result = storemateOutboundPayloadSchema.safeParse(payloadFalseDemo);
      expect(result.success).toBe(false);
    });

    it('17. Invariant enforcement: noindex and nofollow MUST be true', () => {
      const payloadNoNoindex = {
        ...validOutboundPayload,
        metadata: {
          ...validOutboundPayload.metadata,
          noindex: false
        }
      };
      expect(storemateOutboundPayloadSchema.safeParse(payloadNoNoindex).success).toBe(false);

      const payloadNoNofollow = {
        ...validOutboundPayload,
        metadata: {
          ...validOutboundPayload.metadata,
          nofollow: false
        }
      };
      expect(storemateOutboundPayloadSchema.safeParse(payloadNoNofollow).success).toBe(false);
    });

    it('18. Data minimization: strictly rejects CRM notes, follow-up notes, and audit logs in outbound payload', () => {
      const payloadWithCrmNotes = {
        ...validOutboundPayload,
        crmNotes: 'Client expressed high budget in sales conversation'
      };
      expect(storemateOutboundPayloadSchema.safeParse(payloadWithCrmNotes).success).toBe(false);

      const payloadWithInternalSecrets = {
        ...validOutboundPayload,
        userPasswordHash: '$2b$10$hashedpassword',
        internalAuditLogs: [{ action: 'LEAD_ASSIGNED' }]
      };
      expect(storemateOutboundPayloadSchema.safeParse(payloadWithInternalSecrets).success).toBe(false);
    });

    it('19. Handles omitted branding and social sections safely', () => {
      const minimalOutbound = {
        business: {
          name: 'Simple Street Corner Cafe'
        },
        contact: {
          phone: '+8801800000000'
        },
        metadata: {
          leadId: 'a0000000-0000-0000-0000-000000000001',
          organizationId: 'b0000000-0000-0000-0000-000000000001',
          templateKey: 'generic-local-business',
          isDemo: true as const,
          noindex: true as const,
          nofollow: true as const
        }
      };
      const result = storemateOutboundPayloadSchema.safeParse(minimalOutbound);
      expect(result.success).toBe(true);
    });
  });
});
