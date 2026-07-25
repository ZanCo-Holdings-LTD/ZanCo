import 'server-only';
import { createDatabase, createPool, withUser, type Database, type Transaction } from '@aggregatoriq/db';
import { serverEnv } from '@/env';

/**
 * One pool per process, reused across requests.
 *
 * Next's development server re-evaluates modules on every change, so the pool is
 * cached on `globalThis` — otherwise a morning's editing exhausts Postgres's
 * connection limit and the failure looks like a database problem rather than a
 * hot-reload one.
 */
const globalForDb = globalThis as unknown as { aggregatoriqDb?: Database };

export function db(): Database {
  if (globalForDb.aggregatoriqDb) return globalForDb.aggregatoriqDb;

  const env = serverEnv();
  const pool = createPool({
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    applicationName: 'aggregatoriq-web',
    // The web tier is the one most likely to sit behind a transaction-mode
    // pooler, which cannot honour named prepared statements.
    prepare: false,
  });

  const instance = createDatabase(pool);
  globalForDb.aggregatoriqDb = instance;
  return instance;
}

/**
 * Run a query as the signed-in user.
 *
 * Every read and write in the app goes through here. The identity is set
 * transaction-locally, so row-level security applies and a pooled connection
 * cannot carry one user's scope into the next request.
 */
export async function asUser<T>(
  userId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withUser(db(), userId, work);
}
