/**
 * The Drizzle schema and the migrations must describe the same database.
 *
 * The migrations are the source of truth; `src/schema.ts` is the typed view used
 * to build queries. When they drift the failure is not a compile error, it is a
 * query that returns undefined for a column that exists — so the drift is caught
 * here, against the live catalogue.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';
import { ownerPool } from './helpers.js';
import * as schema from '../src/schema.js';

const pool: postgres.Sql = ownerPool();

afterAll(async () => {
  await pool.end();
});

/**
 * The schema module exports a heterogeneous mix of tables and enums, so both
 * accessors widen to `unknown` first. Drizzle's per-table literal types make a
 * direct `PgTable[]` narrowing impossible without discarding the column types
 * this test needs.
 */
function declaredTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter(
    (value): value is PgTable => value instanceof PgTable,
  );
}

interface DeclaredEnum {
  enumName: string;
  enumValues: readonly string[];
}

function declaredEnums(): DeclaredEnum[] {
  return (Object.values(schema) as unknown[]).filter(
    (value): value is DeclaredEnum =>
      typeof value === 'function' &&
      'enumName' in value &&
      'enumValues' in value &&
      Array.isArray((value as DeclaredEnum).enumValues),
  );
}

describe('tables', () => {
  it('all exist in the database', async () => {
    const rows = await pool<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'
    `;
    const live = new Set(rows.map((row) => row.tablename));

    for (const table of declaredTables()) {
      expect(live.has(getTableName(table)), `${getTableName(table)} is not in the database`).toBe(true);
    }
  });

  it('have every declared column, with matching nullability', async () => {
    const rows = await pool<
      { table_name: string; column_name: string; is_nullable: string }[]
    >`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
    `;

    const live = new Map<string, Map<string, boolean>>();
    for (const row of rows) {
      const columns = live.get(row.table_name) ?? new Map<string, boolean>();
      columns.set(row.column_name, row.is_nullable === 'YES');
      live.set(row.table_name, columns);
    }

    const problems: string[] = [];

    for (const table of declaredTables()) {
      const tableName = getTableName(table);
      const liveColumns = live.get(tableName);
      if (!liveColumns) {
        problems.push(`${tableName}: table missing`);
        continue;
      }

      for (const [, column] of Object.entries(getTableColumns(table))) {
        const liveNullable = liveColumns.get(column.name);
        if (liveNullable === undefined) {
          problems.push(`${tableName}.${column.name}: declared in Drizzle, absent in the database`);
          continue;
        }
        const declaredNullable = !column.notNull;
        if (declaredNullable !== liveNullable) {
          problems.push(
            `${tableName}.${column.name}: Drizzle says ${declaredNullable ? 'nullable' : 'not null'}, ` +
              `the database says ${liveNullable ? 'nullable' : 'not null'}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('have no database column the Drizzle schema is unaware of', async () => {
    const rows = await pool<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
    `;

    const declared = new Map<string, Set<string>>();
    for (const table of declaredTables()) {
      declared.set(
        getTableName(table),
        new Set(Object.values(getTableColumns(table)).map((column) => column.name)),
      );
    }

    const missing = rows
      .filter((row) => declared.has(row.table_name))
      .filter((row) => !declared.get(row.table_name)!.has(row.column_name))
      .map((row) => `${row.table_name}.${row.column_name}`);

    expect(missing).toEqual([]);
  });
});

describe('enums', () => {
  it('have the same labels in the database as in @aggregatoriq/core', async () => {
    // Adding a value in one place and forgetting the other fails here rather
    // than at the first insert in production.
    const rows = await pool<{ enum_name: string; label: string; sort_order: number }[]>`
      select t.typname as enum_name, e.enumlabel as label, e.enumsortorder as sort_order
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
      order by t.typname, e.enumsortorder
    `;

    const live = new Map<string, string[]>();
    for (const row of rows) {
      const labels = live.get(row.enum_name) ?? [];
      labels.push(row.label);
      live.set(row.enum_name, labels);
    }

    const problems: string[] = [];

    for (const declared of declaredEnums()) {
      const name = declared.enumName;
      const liveLabels = live.get(name);
      if (!liveLabels) {
        problems.push(`${name}: enum missing from the database`);
        continue;
      }
      if (JSON.stringify(liveLabels) !== JSON.stringify([...declared.enumValues])) {
        problems.push(
          `${name}: database has ${JSON.stringify(liveLabels)}, code has ` +
            `${JSON.stringify(declared.enumValues)}`,
        );
      }
    }

    expect(problems).toEqual([]);
  });
});

describe('migrations', () => {
  it('are all recorded as applied', async () => {
    const rows = await pool<{ version: string }[]>`
      select version from schema_migrations order by version
    `;
    expect(rows.map((row) => row.version)).toEqual(['0001_init', '0002_rls']);
  });
});
