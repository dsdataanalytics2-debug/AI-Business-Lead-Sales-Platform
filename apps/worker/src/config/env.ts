import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  REDIS_KEY_PREFIX: z.string().default('leadmate'),
  OUTREACH_WHATSAPP_PROVIDER: z.enum(['mock', 'meta']).optional(),
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_API_VERSION: z.string().default('v22.0'),
  META_WHATSAPP_BASE_URL: z.string().default('https://graph.facebook.com'),
  META_WHATSAPP_TIMEOUT_MS: z.coerce.number().default(10000)
}).superRefine((data, ctx) => {
  const isProduction = data.NODE_ENV === 'production';
  if (isProduction && !data.OUTREACH_WHATSAPP_PROVIDER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OUTREACH_WHATSAPP_PROVIDER'],
      message: 'OUTREACH_WHATSAPP_PROVIDER must be explicitly configured in production (cannot default implicitly)'
    });
    return;
  }

  const effectiveProvider = data.OUTREACH_WHATSAPP_PROVIDER ?? 'mock';

  if (effectiveProvider === 'meta') {
    if (!data.META_WHATSAPP_ACCESS_TOKEN || data.META_WHATSAPP_ACCESS_TOKEN.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['META_WHATSAPP_ACCESS_TOKEN'],
        message: 'META_WHATSAPP_ACCESS_TOKEN is required when OUTREACH_WHATSAPP_PROVIDER is meta'
      });
    }
    if (!data.META_WHATSAPP_PHONE_NUMBER_ID || data.META_WHATSAPP_PHONE_NUMBER_ID.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['META_WHATSAPP_PHONE_NUMBER_ID'],
        message: 'META_WHATSAPP_PHONE_NUMBER_ID is required when OUTREACH_WHATSAPP_PROVIDER is meta'
      });
    }
  }
}).transform((data) => ({
  ...data,
  OUTREACH_WHATSAPP_PROVIDER: data.OUTREACH_WHATSAPP_PROVIDER ?? 'mock'
}));

export { workerEnvSchema };

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

function parseWorkerEnv(): WorkerEnv {
  const result = workerEnvSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.format();
    console.error('Worker environment configuration error:', errorDetails);
    throw new Error('Invalid worker environment variables');
  }
  return result.data;
}

export const workerEnv = parseWorkerEnv();
