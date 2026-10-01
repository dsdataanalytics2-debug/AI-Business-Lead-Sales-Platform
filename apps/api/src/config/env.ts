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
  DEFAULT_CURRENCY: z.string().default('BDT')
});

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
