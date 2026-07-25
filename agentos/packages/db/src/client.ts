/**
 * Database connections and the session context that RLS depends on.
 *
 * The important idea here is `withUser`. Row-level security decides what a
 * query can see from a session variable, and a session variable set outside a
 * transaction on a pooled connection is a tenant-leak waiting to happen — the
 * next request to borrow that connection inherits it. So the identity is set
 * with `set_config(..., true)`, which is transaction-local, and every
 * org-scoped query runs inside the transaction that set it.
 *
 * There is no way to run an org-scoped query without going through one of these
 * wrappers, which is deliberate.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface PoolOptions {
  readonly url: string;
  readonly max?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
  readonly ssl?: boolean;
  readonly applicationName?: string;
  readonly onNotice?: (notice: unknown) => void;
}

export function createPool(options: PoolOptions): postgres.Sql {
  return postgres(options.url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    ssl: options.ssl ? 'require' : undefined,
    connection: {
      application_name: options.applicationName ?? 'agentos',
    },
    onnotice: options.onNotice ?? (() => {}),
    // Calendar dates are read as strings, not as JS Date objects. Postgres
    // OIDs 1082 (date) and 1114/1184 (timestamp) are handled by drizzle's
    // column modes; this guards the raw-SQL escape hatch.
    types: {
      bigint: postgres.BigInt,
    },
  });
}

export function createDatabase(pool: postgres.Sql): Database {
  return drizzle(pool, { schema });
}

export interface StaffSession {
  readonly userId: string;
}

export interface PortalSession {
  readonly entityId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) {
    throw new TypeError(`${label} must be a UUID, got ${JSON.stringify(value)}`);
  }
}

/**
 * Run a unit of work as a signed-in staff user.
 *
 * Everything inside sees exactly the rows the policies in 0002_rls.sql allow
 * that user, and the identity is discarded when the transaction ends whether it
 * commits or rolls back.
 */
export async function withUser<T>(
  db: Database,
  session: StaffSession,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  assertUuid(session.userId, 'userId');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${session.userId}, true)`);
    return work(tx);
  });
}

/**
 * Run a unit of work as a client-portal visitor, scoped to one entity.
 *
 * The portal database role holds no INSERT, UPDATE or DELETE grant at all, so
 * "read-only" here is enforced by the database rather than by this wrapper
 * remembering to be careful.
 */
export async function withPortal<T>(
  db: Database,
  session: PortalSession,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  assertUuid(session.entityId, 'entityId');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.portal_entity_id', ${session.entityId}, true)`);
    return work(tx);
  });
}

/**
 * Run work with no session identity.
 *
 * Only valid for the worker, whose role bypasses RLS because the nightly
 * renewal sweep genuinely has to see every organisation. Named so that it is
 * obvious in review when something reaches for it.
 */
export async function withoutTenantScope<T>(
  db: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => work(tx));
}

export { schema };
