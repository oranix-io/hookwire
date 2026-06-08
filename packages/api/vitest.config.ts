import { defineConfig } from 'vitest/config';
import path from 'node:path';

const mocksDir = path.resolve(__dirname, 'src/__tests__/mocks');

export default defineConfig({
  test: {
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    alias: {
      'cloudflare:workers': path.join(mocksDir, 'cloudflare-workers.ts'),
      'vite-ssr-components/hono': path.join(mocksDir, 'vite-ssr-components.ts'),
    },
  },
});
