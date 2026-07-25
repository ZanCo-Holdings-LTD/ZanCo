import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The database client.
 *
 * A single pooled connection per process, cached on `globalThis` so Next's dev
 * server does not open a new pool on every hot reload.
 */

declare global {
  var __sarayanSql: ReturnType<typeof postgres> | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at a Postgres instance.",
    );
  }
  return url;
}

function createClient() {
  const url = connectionString();
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 15,
    // Neon and Supabase both terminate plaintext connections; `sslmode` in the
    // URL wins, this is the fallback for hosts that omit it.
    ssl: url.includes("sslmode=") ? undefined : process.env.NODE_ENV === "production" ? "require" : undefined,
    prepare: false,
  });
}

export const sql = globalThis.__sarayanSql ?? createClient();
if (process.env.NODE_ENV !== "production") globalThis.__sarayanSql = sql;

export const db = drizzle(sql, { schema });

export { schema };
export type Db = typeof db;
