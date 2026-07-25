import { asService as asServiceTx, getDb, repositories as repos } from '@fieldnote/db';
import type { Database } from '@fieldnote/db';

/**
 * The worker's database access.
 *
 * Resolved lazily rather than at module load. Opening a pool as an import side
 * effect means every module that transitively imports a handler needs a live
 * DATABASE_URL just to be loaded — which makes the pure functions in those
 * handlers, like transcript merging, impossible to unit test.
 *
 * Every handler runs through `asService`, which drops to the service role and
 * bypasses RLS: the worker legitimately acts across tenants. That is not a
 * licence to ignore tenancy — every repository call still takes an explicit
 * orgId and filters on it, and the RLS tests exist so the web path stays the
 * one that is enforced rather than merely intended.
 */
export type Db = Database;

let cached: Db | undefined;

export function workerDb(): Db {
  cached ??= getDb({ max: 12 });
  return cached;
}

export const asService = asServiceTx;
export const repositories = repos;
