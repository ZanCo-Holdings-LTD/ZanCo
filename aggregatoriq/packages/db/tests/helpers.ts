/**
 * Test helpers.
 *
 * The important detail: `asAppRole` connects as `aggregatoriq_app`, a role that
 * owns nothing. A table owner bypasses RLS, so an RLS test run as the owner
 * proves nothing at all — it would pass just as happily against a database with
 * every policy dropped.
 */
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { createDatabase, createPool, type Database } from '../src/client.js';

export const TEST_DATABASE_URL = (): string => {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  return url;
};

/** Superuser connection, used to arrange fixtures without fighting policies. */
export function ownerPool(): postgres.Sql {
  return createPool({
    url: TEST_DATABASE_URL(),
    max: 2,
    applicationName: 'aggregatoriq-test-owner',
    prepare: false,
  });
}

/**
 * A connection acting as the application role.
 *
 * postgres-js has no per-connection role switch, so the role is assumed with
 * `set role` on each transaction. `set role` inside a transaction is reverted on
 * commit or rollback, which is exactly the isolation wanted here.
 */
export async function asAppRole<T>(
  pool: postgres.Sql,
  userId: string | null,
  work: (db: Database, tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return pool.begin(async (tx) => {
    await tx.unsafe(`set local role aggregatoriq_app`);
    if (userId !== null) {
      await tx`select set_config('app.user_id', ${userId}, true)`;
    }
    // The drizzle instance is only used for typing convenience in a few places;
    // the raw tagged-template client is what actually runs inside this
    // transaction and therefore inside the role.
    return work(createDatabase(pool), tx);
  }) as Promise<T>;
}

export interface Fixture {
  orgAId: string;
  orgBId: string;
  userAId: string;
  userBId: string;
  outsiderId: string;
  branchAId: string;
  branchBId: string;
  aggregatorId: string;
  sourceDocAId: string;
  sourceRowAId: string;
  orderAId: string;
}

/**
 * Two organisations that must never see each other, plus a user in neither.
 *
 * Built as the owner so the arrangement itself is not subject to the policies
 * under test — otherwise a broken policy could make the fixture fail to build
 * and the test would pass for the wrong reason.
 */
export async function seedTwoOrgs(pool: postgres.Sql): Promise<Fixture> {
  const ids = {
    orgAId: randomUUID(),
    orgBId: randomUUID(),
    userAId: randomUUID(),
    userBId: randomUUID(),
    outsiderId: randomUUID(),
    branchAId: randomUUID(),
    branchBId: randomUUID(),
    sourceDocAId: randomUUID(),
    sourceRowAId: randomUUID(),
    orderAId: randomUUID(),
  };

  const [aggregator] = await pool<{ id: string }[]>`
    select id from aggregators where code = 'talabat' limit 1
  `;
  if (!aggregator) throw new Error('Reference data missing: seed did not run');

  await pool.begin(async (tx) => {
    await tx`
      insert into app_users (id, email) values
        (${ids.userAId}, ${`a-${ids.userAId}@example.com`}),
        (${ids.userBId}, ${`b-${ids.userBId}@example.com`}),
        (${ids.outsiderId}, ${`out-${ids.outsiderId}@example.com`})
    `;
    await tx`
      insert into organisations (id, name, country, base_currency) values
        (${ids.orgAId}, 'Org A', 'AE', 'AED'),
        (${ids.orgBId}, 'Org B', 'SA', 'SAR')
    `;
    await tx`
      insert into org_members (org_id, user_id, role) values
        (${ids.orgAId}, ${ids.userAId}, 'owner'),
        (${ids.orgBId}, ${ids.userBId}, 'owner')
    `;
    await tx`
      insert into branches (id, org_id, name, timezone, currency) values
        (${ids.branchAId}, ${ids.orgAId}, 'A Downtown', 'Asia/Dubai', 'AED'),
        (${ids.branchBId}, ${ids.orgBId}, 'B Olaya', 'Asia/Riyadh', 'SAR')
    `;
    await tx`
      insert into source_documents (id, org_id, branch_id, aggregator_id, kind, storage_path,
                                    received_via, checksum)
      values (${ids.sourceDocAId}, ${ids.orgAId}, ${ids.branchAId}, ${aggregator.id},
              'payout_statement', 'test/a.csv', 'upload', ${`checksum-${ids.sourceDocAId}`})
    `;
    await tx`
      insert into source_rows (id, source_document_id, org_id, row_index, raw)
      values (${ids.sourceRowAId}, ${ids.sourceDocAId}, ${ids.orgAId}, 0,
              ${pool.json({ order_id: 'TLB1', amount: '10.00' }) as never})
    `;
    await tx`
      insert into orders (id, org_id, branch_id, aggregator_id, external_order_id, ordered_at,
                          local_date, gross_amount_minor, item_total_minor, currency, status,
                          source_row_id)
      values (${ids.orderAId}, ${ids.orgAId}, ${ids.branchAId}, ${aggregator.id}, 'TLB1',
              '2025-03-05T10:00:00Z', '2025-03-05', 10500, 10000, 'AED', 'delivered',
              ${ids.sourceRowAId})
    `;
  });

  return { ...ids, aggregatorId: aggregator.id };
}

export async function cleanUp(pool: postgres.Sql, fixture: Fixture): Promise<void> {
  await pool`delete from organisations where id in (${fixture.orgAId}, ${fixture.orgBId})`;
  await pool`
    delete from app_users where id in (${fixture.userAId}, ${fixture.userBId}, ${fixture.outsiderId})
  `;
}
