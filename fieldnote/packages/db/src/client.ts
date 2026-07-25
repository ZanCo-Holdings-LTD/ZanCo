import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

let pool: postgres.Sql | undefined;
let database: Database | undefined;

export interface ConnectionOptions {
  url?: string;
  /** Pool size. Serverless callers want 1; the worker wants more. */
  max?: number;
  /** Set for migrations and RLS tests, which must not go through PgBouncer. */
  direct?: boolean;
}

function connectionString(options: ConnectionOptions): string {
  const url = options.url ?? (options.direct ? process.env.DIRECT_DATABASE_URL : undefined);
  const resolved = url ?? process.env.DATABASE_URL;
  if (!resolved) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  return resolved;
}

export function createClient(options: ConnectionOptions = {}): { db: Database; sql: postgres.Sql } {
  const client = postgres(connectionString(options), {
    max: options.max ?? 10,
    // Prepared statements are incompatible with transaction-mode PgBouncer.
    prepare: false,
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), sql: client };
}

/**
 * Process-wide singleton. Next.js route handlers and the worker share one pool
 * per process rather than opening a connection per request.
 */
export function getDb(options: ConnectionOptions = {}): Database {
  if (!database) {
    const created = createClient(options);
    database = created.db;
    pool = created.sql;
  }
  return database;
}

export async function closeDb(): Promise<void> {
  await pool?.end({ timeout: 5 });
  pool = undefined;
  database = undefined;
}

/**
 * Run `fn` with row level security applied as `userId`.
 *
 * This is how the web app talks to the database. The connection role drops to
 * `authenticated` and the JWT subject is set for the duration of the
 * transaction, so every policy in 0001_rls.sql applies exactly as it would to
 * a request arriving through PostgREST. `SET LOCAL` means the settings unwind
 * with the transaction even if `fn` throws, so a pooled connection can never
 * leak one user's identity into the next request.
 *
 * Application code should never reach for a connection that skips this.
 */
export async function withUser<T>(
  db: Database,
  userId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'authenticated', true)`);
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`,
    );
    return fn(tx as unknown as Database);
  });
}

/**
 * Run `fn` with RLS bypassed, as the worker does.
 *
 * Legitimate uses are narrow: the job runner acts across tenants, and webhook
 * handlers act with no user present. Every such call still filters by org_id in
 * the query itself — bypassing the policy is not a licence to ignore tenancy.
 */
export async function asService<T>(db: Database, fn: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'service_role', true)`);
    return fn(tx as unknown as Database);
  });
}
