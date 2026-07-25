/**
 * Connections and the session context row-level security depends on.
 *
 * `withUser` is the important piece. RLS decides what a query can see from a
 * session variable, and a session variable set outside a transaction on a
 * pooled connection is a tenant leak waiting to happen — the next request to
 * borrow that connection inherits it. So the identity is set with
 * `set_config(..., true)`, which is transaction-local, and every org-scoped
 * query runs inside the transaction that set it.
 *
 * There is no way to run an org-scoped query without going through one of these
 * wrappers, and that is the point.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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
  /**
   * Server-side prepared statements. Defaults on.
   *
   * Turn it off behind a transaction-mode connection pooler such as PgBouncer or
   * Supabase's pooled port, which multiplexes statements across backends and
   * cannot honour a named prepared statement. The tests run with it off so that
   * the path exercised in CI matches the one a pooled deployment uses.
   */
  readonly prepare?: boolean;
}

export function createPool(options: PoolOptions): postgres.Sql {
  return postgres(options.url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    ssl: options.ssl ? 'require' : undefined,
    prepare: options.prepare ?? true,
    connection: { application_name: options.applicationName ?? 'aggregatoriq' },
    onnotice: () => {},
  });
}

export function createDatabase(pool: postgres.Sql): Database {
  return drizzle(pool, { schema });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) {
    throw new TypeError(`${label} must be a UUID, got ${JSON.stringify(value)}`);
  }
}

/**
 * Run a unit of work as a signed-in user. Everything inside sees exactly the
 * rows the policies allow that user, and the identity is discarded when the
 * transaction ends whether it commits or rolls back.
 */
export async function withUser<T>(
  db: Database,
  userId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  assertUuid(userId, 'userId');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return work(tx);
  });
}

/**
 * Run work with no user identity.
 *
 * Only valid for the worker, whose role bypasses RLS because parsing and the
 * nightly reconciliation sweep genuinely have to see every organisation. Named
 * so it is obvious in review when something reaches for it.
 */
export async function withoutTenantScope<T>(
  db: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => work(tx));
}

export { schema };
