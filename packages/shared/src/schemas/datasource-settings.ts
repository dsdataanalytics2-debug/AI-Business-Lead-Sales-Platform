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

export const dataSourceStatusSchema = z.enum([
  'NOT_CONFIGURED',
  'CONNECTED',
  'DISABLED',
  'ERROR'
]);

export type DataSourceCardStatus = z.infer<typeof dataSourceStatusSchema>;

export const dataSourceCardSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  status: dataSourceStatusSchema,
  isActive: z.boolean(),
  isEnabled: z.boolean(),
  isConfigured: z.boolean(),
  costType: z.enum(['FREE', 'PAID', 'HYBRID']),
  requiresCredential: z.boolean(),
  credentialMasked: z.string().nullable().optional(),
  credentialLastFour: z.string().nullable().optional(),
  lastTestedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export type DataSourceCardDTO = z.infer<typeof dataSourceCardSchema>;

export const dataSourcesListResponseSchema = z.object({
  activeProvider: z.string(),
  dataSources: z.array(dataSourceCardSchema)
});

export type DataSourcesListResponse = z.infer<typeof dataSourcesListResponseSchema>;
