import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@tutwithus/contracts/admin',
        replacement: fileURLToPath(
          new URL('../api/src/contracts/admin.ts', import.meta.url),
        ),
      },
      {
        find: '@tutwithus/contracts/jobs',
        replacement: fileURLToPath(
          new URL('../api/src/contracts/jobs.ts', import.meta.url),
        ),
      },
      {
        find: '@tutwithus/contracts',
        replacement: fileURLToPath(
          new URL('../api/src/contracts/index.ts', import.meta.url),
        ),
      },
    ],
  },
  server: {
    allowedHosts: ['lap-quantity-oregon-supports.trycloudflare.com'],
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/healthz': 'http://127.0.0.1:3000',
      '/readyz': 'http://127.0.0.1:3000',
    },
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
  },
});
