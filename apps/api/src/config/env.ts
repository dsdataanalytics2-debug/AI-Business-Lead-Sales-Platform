import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  API_BASE_URL: z.string().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_TEST: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  REDIS_KEY_PREFIX: z.string().default('leadmate'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  CREDENTIAL_ENCRYPTION_KEY: z.string().default('change-me-32-byte-secret-hex-or-string'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Dhaka'),
  DEFAULT_CURRENCY: z.string().default('BDT'),

  // Outreach Delivery Provider Configuration
  OUTREACH_WHATSAPP_PROVIDER: z.enum(['mock', 'meta']).optional(),
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_APP_SECRET: z.string().optional(),
  META_WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  META_WHATSAPP_API_VERSION: z.string().default('v22.0'),
  META_WHATSAPP_BASE_URL: z.string().default('https://graph.facebook.com'),
  META_WHATSAPP_TIMEOUT_MS: z.coerce.number().default(10000),

  OUTREACH_EMAIL_PROVIDER: z.enum(['mock', 'resend']).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_FROM_NAME: z.string().optional(),
  RESEND_API_BASE_URL: z.string().default('https://api.resend.com'),
  RESEND_TIMEOUT_MS: z.coerce.number().default(10000),
  RESEND_WEBHOOK_SECRET: z.string().optional()
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
    if (!data.META_WHATSAPP_APP_SECRET || data.META_WHATSAPP_APP_SECRET.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['META_WHATSAPP_APP_SECRET'],
        message: 'META_WHATSAPP_APP_SECRET is required when OUTREACH_WHATSAPP_PROVIDER is meta'
      });
    }
    if (!data.META_WHATSAPP_VERIFY_TOKEN || data.META_WHATSAPP_VERIFY_TOKEN.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['META_WHATSAPP_VERIFY_TOKEN'],
        message: 'META_WHATSAPP_VERIFY_TOKEN is required when OUTREACH_WHATSAPP_PROVIDER is meta'
      });
    }
  }

  if (isProduction && !data.OUTREACH_EMAIL_PROVIDER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OUTREACH_EMAIL_PROVIDER'],
      message: 'OUTREACH_EMAIL_PROVIDER must be explicitly configured in production (cannot default implicitly)'
    });
    return;
  }

  const effectiveEmailProvider = data.OUTREACH_EMAIL_PROVIDER ?? 'mock';

  if (effectiveEmailProvider === 'resend') {
    if (!data.RESEND_API_KEY || data.RESEND_API_KEY.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when OUTREACH_EMAIL_PROVIDER is resend'
      });
    }
    if (!data.RESEND_FROM_EMAIL || data.RESEND_FROM_EMAIL.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_FROM_EMAIL'],
        message: 'RESEND_FROM_EMAIL is required when OUTREACH_EMAIL_PROVIDER is resend'
      });
    }
    if (isProduction && (!data.RESEND_WEBHOOK_SECRET || data.RESEND_WEBHOOK_SECRET.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_WEBHOOK_SECRET'],
        message: 'RESEND_WEBHOOK_SECRET is required in production when OUTREACH_EMAIL_PROVIDER is resend'
      });
    }
  }
}).transform((data) => ({
  ...data,
  OUTREACH_WHATSAPP_PROVIDER: data.OUTREACH_WHATSAPP_PROVIDER ?? 'mock',
  OUTREACH_EMAIL_PROVIDER: data.OUTREACH_EMAIL_PROVIDER ?? 'mock'
}));

export { envSchema };

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.format();
    console.error('Environment configuration error:', errorDetails);
    throw new Error('Invalid environment variables');
  }
  return result.data;
}

export const env = parseEnv();
