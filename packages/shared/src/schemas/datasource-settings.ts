import { z } from 'zod';

export const configureGooglePlacesSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(10, 'Google Places API key must be at least 10 characters')
    .max(255, 'Google Places API key is too long')
});

export type ConfigureGooglePlacesRequest = z.infer<typeof configureGooglePlacesSchema>;

export const testGooglePlacesSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(10, 'Google Places API key must be at least 10 characters')
    .max(255, 'Google Places API key is too long')
    .optional()
});

export type TestGooglePlacesRequest = z.infer<typeof testGooglePlacesSchema>;

export const configureProviderCredentialSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(5, 'Credential must be at least 5 characters')
    .max(500, 'Credential is too long')
});

export type ConfigureProviderCredentialRequest = z.infer<typeof configureProviderCredentialSchema>;

export const dataSourceStatusSchema = z.enum([
  'ACTIVE',
  'CONNECTED',
  'NOT_CONFIGURED',
  'DISABLED',
  'ERROR',
  'RATE_LIMITED',
  'UNSUPPORTED'
]);

export type DataSourceCardStatus = z.infer<typeof dataSourceStatusSchema>;

export const providerCapabilitySchema = z.enum([
  'DISCOVERY',
  'ENRICHMENT',
  'INBOUND_LEADS',
  'MESSAGING_SIGNAL',
  'OWNED_ASSET',
  'PROCUREMENT'
]);

export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;

export const providerGroupSchema = z.enum([
  'DISCOVERY',
  'INBOUND_LEADS',
  'ENRICHMENT_ACCOUNT'
]);

export type ProviderGroup = z.infer<typeof providerGroupSchema>;

export const dataSourceCardSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  status: dataSourceStatusSchema,
  capabilities: z.array(providerCapabilitySchema).default([]),
  group: providerGroupSchema.default('DISCOVERY'),
  discoveryStatus: dataSourceStatusSchema.optional(),
  isActive: z.boolean(),
  isEnabled: z.boolean(),
  isConfigured: z.boolean(),
  costType: z.enum(['FREE', 'PAID', 'HYBRID']),
  requiresCredential: z.boolean(),
  credentialMasked: z.string().nullable().optional(),
  credentialLastFour: z.string().nullable().optional(),
  lastTestedAt: z.string().nullable().optional(),
  lastSuccessfulRequestAt: z.string().nullable().optional(),
  lastFailureAt: z.string().nullable().optional(),
  lastErrorCode: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export type DataSourceCardDTO = z.infer<typeof dataSourceCardSchema>;

export const dataSourcesListResponseSchema = z.object({
  activeProvider: z.string(),
  dataSources: z.array(dataSourceCardSchema)
});

export type DataSourcesListResponse = z.infer<typeof dataSourcesListResponseSchema>;
