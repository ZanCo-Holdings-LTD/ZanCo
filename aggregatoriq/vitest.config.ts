import { defineConfig } from 'vitest/config';

/**
 * Two projects, because they need different things to run.
 *
 * `unit` is pure and runs anywhere. `db` needs a live Postgres and holds the RLS
 * proofs — the tests that show a user in one organisation cannot read another's
 * data. Both run in CI; only `unit` runs by default locally, so `pnpm test` never
 * fails for the boring reason that Postgres is not up.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.pg.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['packages/db/tests/**/*.pg.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'node',
          // One database, shared. Parallel files would tear down each other's
          // schema mid-test.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ['packages/db/tests/global-setup.ts'],
        },
      },
    ],
  },
});
