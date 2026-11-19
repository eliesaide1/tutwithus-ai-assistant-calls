import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@tutwithus/contracts/admin',
        replacement: fileURLToPath(
          new URL('./src/contracts/admin.ts', import.meta.url),
        ),
      },
      {
        find: '@tutwithus/contracts/jobs',
        replacement: fileURLToPath(
          new URL('./src/contracts/jobs.ts', import.meta.url),
        ),
      },
      {
        find: '@tutwithus/contracts',
        replacement: fileURLToPath(
          new URL('./src/contracts/index.ts', import.meta.url),
        ),
      },
    ],
  },
});
