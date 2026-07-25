/**
 * Builds the test database once for the whole `db` project.
 *
 * Runs the real migrations against a real Postgres — not a mock, not an
 * in-memory shim. The point of these tests is to prove that the RLS policies
 * behave, and a policy can only be proved by the engine that enforces it.
 */
import { createDatabase, createPool } from '../src/client.js';
import { migrate, resetSchema } from '../src/migrate.js';
import { seedReferenceData } from '../src/seed.js';

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL (or DATABASE_URL) must point at a throwaway Postgres for the db test ' +
        'project. These tests drop and recreate the public schema — never point them at anything ' +
        'you care about.',
    );
  }

  const pool = createPool({ url, max: 1, applicationName: 'aggregatoriq-test-setup' });

  try {
    await resetSchema(pool, 'yes-destroy-all-data');
    await migrate(pool);
    await seedReferenceData(createDatabase(pool));
  } finally {
    await pool.end();
  }
}
