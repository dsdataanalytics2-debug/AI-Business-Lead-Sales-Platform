/**
 * Outreach delivery provider abstraction, deterministic mock providers,
 * hashing utilities, queue contracts, and idempotent delivery domain service.
 *
 * Provides a provider-neutral transport and domain service layer for Milestone M6:
 * - OutreachDeliveryProvider interface
 * - Typed transport inputs (discriminated union) and results
 * - Internal delivery provider error taxonomy & retryability matrix
 * - Deterministic mock providers (MockWhatsAppDeliveryProvider, MockEmailDeliveryProvider)
 * - Provider registry and resolution helpers
 * - Canonical snapshot hashing & request fingerprinting (SHA-256)
 * - OutreachDeliveryQueue interface & in-memory test queue
 * - Domain service errors (OutreachServiceError)
 * - OutreachDeliveryService (idempotent request creation, role authorization, suppression Gate A)
 */

export * from './interfaces.js';
export * from './errors.js';
export * from './mock-whatsapp-provider.js';
export * from './mock-email-provider.js';
export * from './registry.js';
export * from './service-errors.js';
export * from './hashing.js';
export * from './queue.js';
export * from './outreach-delivery-service.js';
export * from './worker-delivery-executor.js';
export * from './webhook-event-processor.js';
export * from './meta-whatsapp-provider.js';
export * from './meta-whatsapp-normalizer.js';
export * from './resend-email-provider.js';
export * from './resend-email-normalizer.js';
