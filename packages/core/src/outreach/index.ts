/**
 * Outreach delivery provider abstraction and deterministic mock providers.
 *
 * Provides a provider-neutral transport layer for Milestone M6:
 * - OutreachDeliveryProvider interface
 * - Typed transport inputs (discriminated union) and results
 * - Internal delivery provider error taxonomy & retryability matrix
 * - Deterministic mock providers (MockWhatsAppDeliveryProvider, MockEmailDeliveryProvider)
 * - Provider registry and resolution helpers
 */

export * from './interfaces.js';
export * from './errors.js';
export * from './mock-whatsapp-provider.js';
export * from './mock-email-provider.js';
export * from './registry.js';
