import { defineConfig } from 'vitest/config';

// Projects map onto CI jobs: `unit`, `physics` and `rooms`, and the nightly `soak`.
// Run one with `vitest run --project <name>` (see the npm scripts).
export default defineConfig({
  test: {
    maxWorkers: 4,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['{apps,packages,tools}/**/*.test.{ts,mjs}'],
          exclude: [
            '**/node_modules/**',
            'packages/sim/validation/**',
            'packages/ai/validation/**',
            'packages/race/validation/**',
            '**/*.runtime.test.*',
          ],
        },
      },
      {
        test: {
          name: 'physics',
          environment: 'node',
          include: [
            'packages/sim/validation/**/*.test.ts',
            'packages/ai/validation/**/*.test.ts',
            'packages/race/validation/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/*.soak.test.ts'],
        },
      },
      {
        // Nightly only (npm run test:soak): long runs of the reference driver.
        test: {
          name: 'soak',
          environment: 'node',
          include: ['packages/**/*.soak.test.ts'],
          testTimeout: 600_000,
          hookTimeout: 600_000,
        },
      },
      {
        test: {
          name: 'rooms',
          environment: 'node',
          include: [
            'services/rooms/test/**/*.test.ts',
            'packages/protocol/test/**/*.test.ts',
            'tools/serve/**/*.runtime.test.mjs',
          ],
          globalSetup: ['services/rooms/test/global-setup.ts'],
          testTimeout: 90_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
