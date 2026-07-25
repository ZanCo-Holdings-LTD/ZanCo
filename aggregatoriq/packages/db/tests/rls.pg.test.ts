/**
 * The tenant boundary, proved.
 *
 * These run as `aggregatoriq_app` — a role that owns no tables, because an owner
 * bypasses RLS and a test passing as the owner would pass equally against a
 * database with every policy dropped. The first test in this file asserts that
 * property, so the rest cannot be quietly invalidated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { asAppRole, cleanUp, ownerPool, seedTwoOrgs, type Fixture } from './helpers.js';

let pool: postgres.Sql;
let fx: Fixture;

beforeAll(async () => {
  pool = ownerPool();
  fx = await seedTwoOrgs(pool);
});

afterAll(async () => {
  await cleanUp(pool, fx);
  await pool.end();
});

describe('the test setup itself', () => {
  it('runs as a role that cannot bypass RLS', () => {
    // If this ever fails, every other test in this file is meaningless.
    return asAppRole(pool, fx.userAId, async (_db, tx) => {
      const [row] = await tx<{ current: string; bypass: boolean; superuser: boolean }[]>`
        select current_user as current,
               rolbypassrls as bypass,
               rolsuper as superuser
        from pg_roles where rolname = current_user
      `;
      expect(row!.current).toBe('aggregatoriq_app');
      expect(row!.bypass).toBe(false);
      expect(row!.superuser).toBe(false);
    });
  });

  it('has row level security enabled on every tenant table', async () => {
    const rows = await pool<{ tablename: string; rowsecurity: boolean }[]>`
      select tablename, rowsecurity from pg_tables
      where schemaname = 'public' and tablename <> 'schema_migrations'
    `;
    const unprotected = rows.filter((row) => !row.rowsecurity).map((row) => row.tablename);
    expect(unprotected).toEqual([]);
  });
});

describe('cross-organisation reads', () => {
  it('shows a user only their own organisation', async () => {
    await asAppRole(pool, fx.userAId, async (_db, tx) => {
      const rows = await tx<{ id: string }[]>`select id from organisations`;
      expect(rows.map((row) => row.id)).toEqual([fx.orgAId]);
    });
  });

  it('hides another organisation’s branches', async () => {
    await asAppRole(pool, fx.userAId, async (_db, tx) => {
      const rows = await tx<{ id: string }[]>`select id from branches`;
      expect(rows.map((row) => row.id)).toEqual([fx.branchAId]);
    });

    await asAppRole(pool, fx.userBId, async (_db, tx) => {
      const rows = await tx<{ id: string }[]>`select id from branches`;
      expect(rows.map((row) => row.id)).toEqual([fx.branchBId]);
    });
  });

  it('returns nothing rather than erroring when reading a specific foreign row', async () => {
    // The row simply does not exist as far as this user is concerned, which is
    // the behaviour that stops an attacker enumerating ids by error message.
    await asAppRole(pool, fx.userBId, async (_db, tx) => {
      const rows = await tx`select id from branches where id = ${fx.branchAId}`;
      expect(rows).toHaveLength(0);
    });
  });

  it('hides raw, canonical and derived rows across the boundary', async () => {
    await asAppRole(pool, fx.userBId, async (_db, tx) => {
      for (const table of ['source_documents', 'source_rows', 'orders', 'payouts', 'payout_lines']) {
        const rows = await tx.unsafe(`select id from ${table}`);
        expect(rows, `${table} leaked to another organisation`).toHaveLength(0);
      }
    });
  });

  it('shows a user with no membership nothing at all', async () => {
    await asAppRole(pool, fx.outsiderId, async (_db, tx) => {
      const orgs = await tx`select id from organisations`;
      const branches = await tx`select id from branches`;
      expect(orgs).toHaveLength(0);
      expect(branches).toHaveLength(0);
    });
  });

  it('shows an unauthenticated session nothing at all', async () => {
    // No app.user_id set: current_user_id() is null and every policy fails.
    await asAppRole(pool, null, async (_db, tx) => {
      const orgs = await tx`select id from organisations`;
      expect(orgs).toHaveLength(0);
    });
  });
});

describe('cross-organisation writes', () => {
  it('refuses to insert a branch into another organisation', async () => {
    await expect(
      asAppRole(pool, fx.userBId, async (_db, tx) => {
        await tx`
          insert into branches (org_id, name, timezone, currency)
          values (${fx.orgAId}, 'Smuggled', 'Asia/Dubai', 'AED')
        `;
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('silently affects nothing when updating another organisation’s row', async () => {
    await asAppRole(pool, fx.userBId, async (_db, tx) => {
      const updated = await tx`
        update branches set name = 'Renamed' where id = ${fx.branchAId} returning id
      `;
      expect(updated).toHaveLength(0);
    });

    const [row] = await pool<{ name: string }[]>`
      select name from branches where id = ${fx.branchAId}
    `;
    expect(row!.name).toBe('A Downtown');
  });

  it('silently affects nothing when deleting another organisation’s row', async () => {
    await asAppRole(pool, fx.userBId, async (_db, tx) => {
      const deleted = await tx`delete from branches where id = ${fx.branchAId} returning id`;
      expect(deleted).toHaveLength(0);
    });

    const rows = await pool`select id from branches where id = ${fx.branchAId}`;
    expect(rows).toHaveLength(1);
  });

  it('refuses to move one of its own rows into another organisation', async () => {
    await expect(
      asAppRole(pool, fx.userBId, async (_db, tx) => {
        await tx`update branches set org_id = ${fx.orgAId} where id = ${fx.branchBId}`;
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('organisation creation on first login', () => {
  it('lets a new user create an organisation and become its owner', async () => {
    const userId = randomUUID();
    const orgId = randomUUID();

    await pool`insert into app_users (id, email) values (${userId}, ${`new-${userId}@example.com`})`;

    await asAppRole(pool, userId, async (_db, tx) => {
      await tx`insert into organisations (id, name) values (${orgId}, 'Fresh Org')`;
      await tx`insert into org_members (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`;
    });

    await asAppRole(pool, userId, async (_db, tx) => {
      const rows = await tx<{ id: string }[]>`select id from organisations`;
      expect(rows.map((row) => row.id)).toEqual([orgId]);
    });

    await pool`delete from organisations where id = ${orgId}`;
    await pool`delete from app_users where id = ${userId}`;
  });

  it('does not let a user add themselves to an organisation that already has members', async () => {
    // The "first member" clause is what makes org creation possible; it must not
    // double as a way to join someone else's organisation.
    await expect(
      asAppRole(pool, fx.outsiderId, async (_db, tx) => {
        await tx`
          insert into org_members (org_id, user_id, role)
          values (${fx.orgAId}, ${fx.outsiderId}, 'owner')
        `;
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('role gates', () => {
  it('stops a viewer changing organisation settings', async () => {
    const viewerId = randomUUID();
    await pool`insert into app_users (id, email) values (${viewerId}, ${`v-${viewerId}@example.com`})`;
    await pool`
      insert into org_members (org_id, user_id, role) values (${fx.orgAId}, ${viewerId}, 'viewer')
    `;

    await asAppRole(pool, viewerId, async (_db, tx) => {
      // Visible...
      const visible = await tx`select id from organisations where id = ${fx.orgAId}`;
      expect(visible).toHaveLength(1);

      // ...but not editable.
      const updated = await tx`
        update organisations set name = 'Viewer Rename' where id = ${fx.orgAId} returning id
      `;
      expect(updated).toHaveLength(0);
    });

    await pool`delete from org_members where user_id = ${viewerId}`;
    await pool`delete from app_users where id = ${viewerId}`;
  });
});

describe('tables the app must not write', () => {
  it('cannot promote its own subscription plan', async () => {
    await expect(
      asAppRole(pool, fx.userAId, async (_db, tx) => {
        await tx`
          insert into subscriptions (org_id, price_per_branch_minor)
          values (${fx.orgAId}, 0)
        `;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('cannot edit the cause code taxonomy', async () => {
    await expect(
      asAppRole(pool, fx.userAId, async (_db, tx) => {
        await tx`update cause_codes set counts_towards_recovery = true where code = 'LATE_PAYOUT'`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('cannot rewrite the audit log', async () => {
    await asAppRole(pool, fx.userAId, async (_db, tx) => {
      await tx`
        insert into audit_log (org_id, action, target_table, target_id)
        values (${fx.orgAId}, 'test.action', 'branches', ${fx.branchAId})
      `;
    });

    await expect(
      asAppRole(pool, fx.userAId, async (_db, tx) => {
        await tx`delete from audit_log where org_id = ${fx.orgAId}`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('the raw layer is immutable', () => {
  it('rejects an update to a source row', async () => {
    // Enforced by a trigger, so even the owner cannot do it. A parser fix is a
    // replay, never an edit of what the aggregator sent.
    await expect(
      pool`update source_rows set raw = '{}'::jsonb where id = ${fx.sourceRowAId}`,
    ).rejects.toThrow(/append-only/i);
  });

  it('gives the app role no way to delete a source row', async () => {
    // Deletion is governed by grants rather than by the trigger, so that an
    // organisation deleting its account still takes its raw statements with it.
    await expect(
      asAppRole(pool, fx.userAId, async (_db, tx) => {
        await tx`delete from source_rows where id = ${fx.sourceRowAId}`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses to delete a raw row a canonical row depends on', async () => {
    // on delete restrict via orders.source_row_id: lineage cannot be orphaned
    // while the variance citing it is still on someone's screen.
    await expect(
      pool`delete from source_rows where id = ${fx.sourceRowAId}`,
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('still lets an organisation delete its account, raw layer and all', async () => {
    // Account deletion has to work. A cascade from organisations must reach the
    // raw rows, or the "delete my data" promise is one the product cannot keep.
    const orgId = randomUUID();
    const docId = randomUUID();
    const rowId = randomUUID();

    await pool`insert into organisations (id, name) values (${orgId}, 'Departing Org')`;
    await pool`
      insert into source_documents (id, org_id, kind, storage_path, received_via, checksum)
      values (${docId}, ${orgId}, 'payout_statement', 'gone.csv', 'upload', ${`gone-${docId}`})
    `;
    await pool`
      insert into source_rows (id, source_document_id, org_id, row_index, raw)
      values (${rowId}, ${docId}, ${orgId}, 0, '{"order_id":"TLB-GONE"}'::jsonb)
    `;

    await pool`delete from organisations where id = ${orgId}`;

    expect(await pool`select id from source_rows where id = ${rowId}`).toHaveLength(0);
    expect(await pool`select id from source_documents where id = ${docId}`).toHaveLength(0);
  });
});
