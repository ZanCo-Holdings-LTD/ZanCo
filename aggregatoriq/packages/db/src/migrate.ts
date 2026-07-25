/**
 * The migration runner.
 *
 * Deliberately small and deliberately ours. Two properties matter more than
 * features:
 *
 *   Each migration runs inside a transaction, so a failure half way through
 *   leaves the schema exactly as it was rather than in a state nobody has a
 *   name for.
 *
 *   Applied migrations are checksummed. Editing a migration that has already
 *   run is caught at the next deploy instead of producing two databases with
 *   the same version number and different schemas — which is the specific
 *   failure that makes a production incident unreproducible locally.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationFile {
  readonly version: string;
  readonly path: string;
  readonly sql: string;
  readonly checksum: string;
}

export class MigrationChecksumError extends Error {
  constructor(version: string) {
    super(
      `Migration ${version} has already been applied but its contents have changed. ` +
        `Applied migrations are immutable — add a new migration instead. Editing this one ` +
        `would leave environments with the same version number and different schemas.`,
    );
    this.name = 'MigrationChecksumError';
  }
}

export async function loadMigrations(directory = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();

  return Promise.all(
    entries.map(async (name) => {
      const path = join(directory, name);
      const sql = await readFile(path, 'utf8');
      return {
        version: name.replace(/\.sql$/, ''),
        path,
        sql,
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
      };
    }),
  );
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export async function migrate(
  client: postgres.Sql,
  options: { directory?: string; log?: (message: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => {});

  await client.unsafe(`
    create table if not exists schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const existing = await client<{ version: string; checksum: string }[]>`
    select version, checksum from schema_migrations
  `;
  const applied = new Map(existing.map((row) => [row.version, row.checksum]));

  const migrations = await loadMigrations(options.directory);
  const newlyApplied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const previous = applied.get(migration.version);

    if (previous !== undefined) {
      if (previous !== migration.checksum) throw new MigrationChecksumError(migration.version);
      skipped.push(migration.version);
      continue;
    }

    log(`applying ${migration.version}`);
    await client.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx`
        insert into schema_migrations (version, checksum)
        values (${migration.version}, ${migration.checksum})
      `;
    });
    newlyApplied.push(migration.version);
  }

  return { applied: newlyApplied, skipped };
}

/**
 * Drop and recreate the public schema. Development and test only — guarded by
 * an explicit argument rather than an environment check, because an environment
 * check is exactly the thing that is wrong on the day it matters.
 */
export async function resetSchema(
  client: postgres.Sql,
  confirmation: 'yes-destroy-all-data',
): Promise<void> {
  if (confirmation !== 'yes-destroy-all-data') {
    throw new Error('resetSchema requires explicit confirmation');
  }
  await client.unsafe(`
    drop schema if exists public cascade;
    drop schema if exists app cascade;
    create schema public;
  `);
}
