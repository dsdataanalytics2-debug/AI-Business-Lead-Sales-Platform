import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.test.ts'],
    alias: {
      '@leadmate/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@leadmate/db': path.resolve(__dirname, './packages/db/src/index.ts'),
      '@leadmate/core': path.resolve(__dirname, './packages/core/src/index.ts')
    }
  }
});
