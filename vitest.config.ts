import { defineConfig } from 'vitest/config';

// Three projects map onto three CI jobs: `unit`, `physics` and `rooms`.
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
          exclude: ['**/node_modules/**', 'packages/sim/validation/**'],
        },
      },
      {
        test: {
          name: 'physics',
          environment: 'node',
          include: ['packages/sim/validation/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'rooms',
          environment: 'node',
          include: ['services/rooms/test/**/*.test.ts', 'packages/protocol/test/**/*.test.ts'],
          globalSetup: ['services/rooms/test/global-setup.ts'],
          testTimeout: 15_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
