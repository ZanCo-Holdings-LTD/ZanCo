import { defineConfig } from 'vitest/config';

/**
 * Two projects, because they have different requirements to run.
 *
 * `unit` is pure and runs anywhere, including on a laptop with nothing
 * installed. `db` needs a live Postgres and is where the RLS proofs live — the
 * tests that assert one firm cannot read another firm's client data. Both run
 * in CI; only `unit` runs by default locally, so that `pnpm test` never fails
 * for the boring reason that Postgres is not up.
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
          // Migrations and fixtures share one database; running the files in
          // parallel would have them tearing down each other's schema.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ['packages/db/tests/global-setup.ts'],
        },
      },
    ],
  },
});
