import { defineConfig } from 'vitest/config';
import path from 'node:path';
import dotenv from 'dotenv';

// Ensure test environment uses test databases
dotenv.config({ path: path.resolve(__dirname, '.env') });
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
if (process.env.REDIS_URL_TEST) {
  process.env.REDIS_URL = process.env.REDIS_URL_TEST;
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['**/*.spec.ts', '**/*.test.ts'],
    alias: {
      '@leadmate/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@leadmate/db/test-guard': path.resolve(__dirname, './packages/db/src/test-guard.ts'),
      '@leadmate/db': path.resolve(__dirname, './packages/db/src/index.ts'),
      '@leadmate/core': path.resolve(__dirname, './packages/core/src/index.ts')
    }
  }
});
