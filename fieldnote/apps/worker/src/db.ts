import { asService as asServiceTx, getDb, repositories as repos } from '@fieldnote/db';
import type { Database } from '@fieldnote/db';

/**
 * The worker's database access.
 *
 * Every handler runs through `asService`, which drops to the service role and
 * bypasses RLS — the worker legitimately acts across tenants. That is not a
 * licence to ignore tenancy: every repository call still takes an explicit
 * orgId and filters on it, and the RLS tests exist so the web path stays the
 * one that is enforced rather than merely intended.
 */
export type Db = Database;

export const db: Db = getDb({ max: 12 });
export const asService = asServiceTx;
export const repositories = repos;
