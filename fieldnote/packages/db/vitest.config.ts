import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db',
    // RLS tests need a live Postgres; they run as their own CI job.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Policies are global state — parallel files would race on role changes.
    fileParallelism: false,
  },
});
