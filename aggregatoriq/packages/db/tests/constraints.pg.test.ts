/**
 * Database-level invariants.
 *
 * These are the guarantees that must hold even if application code is wrong: a
 * variance with no lineage, a positive commission, two overlapping rate periods.
 * Each is also enforced higher up — the point is that it is enforced *here* too,
 * because the layer that cannot be bypassed is the one worth relying on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { cleanUp, ownerPool, seedTwoOrgs, type Fixture } from './helpers.js';

let pool: postgres.Sql;
let fx: Fixture;
let runId: string;

beforeAll(async () => {
  pool = ownerPool();
  fx = await seedTwoOrgs(pool);

  runId = randomUUID();
  await pool`
    insert into recon_runs (id, org_id, branch_id, aggregator_id, period_start, period_end,
                            engine_version, rule_set_version, run_key,
                            materiality_threshold_minor, currency)
    values (${runId}, ${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId}, '2025-03-01', '2025-03-31',
            '1.0.0', '1.0.0', 'test-run-key', 100, 'AED')
  `;
});

afterAll(async () => {
  await cleanUp(pool, fx);
  await pool.end();
});

function varianceValues(evidence: unknown) {
  return {
    id: randomUUID(),
    evidence,
  };
}

describe('no variance without lineage', () => {
  it('accepts a variance citing real source rows', async () => {
    const { id, evidence } = varianceValues({
      source_row_ids: [fx.sourceRowAId],
      rule: 'commission_rate_mismatch',
      computation: 'Contracted 25% of 100.00 is 25.00; 30.00 was deducted.',
      inputs: {},
    });

    await pool`
      insert into variances (id, recon_run_id, org_id, branch_id, aggregator_id, cause_code,
                             expected_minor, actual_minor, delta_minor, currency, confidence, evidence)
      values (${id}, ${runId}, ${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId},
              'COMMISSION_RATE_MISMATCH', -2500, -3000, 500, 'AED', 1.0, ${pool.json(evidence as never)})
    `;

    const rows = await pool`select id from variances where id = ${id}`;
    expect(rows).toHaveLength(1);
  });

  it('rejects a variance with an empty source row list', async () => {
    const { id, evidence } = varianceValues({
      source_row_ids: [],
      rule: 'fabricated',
      computation: 'trust me',
      inputs: {},
    });

    await expect(
      pool`
        insert into variances (id, recon_run_id, org_id, branch_id, aggregator_id, cause_code,
                               expected_minor, actual_minor, delta_minor, currency, confidence, evidence)
        values (${id}, ${runId}, ${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId},
                'COMMISSION_RATE_MISMATCH', -2500, -3000, 500, 'AED', 1.0, ${pool.json(evidence as never)})
      `,
    ).rejects.toThrow(/variances_evidence_has_source_rows/);
  });

  it('rejects a variance with no rule or no computation', async () => {
    for (const evidence of [
      { source_row_ids: [fx.sourceRowAId], rule: '', computation: 'x', inputs: {} },
      { source_row_ids: [fx.sourceRowAId], rule: 'r', computation: '   ', inputs: {} },
    ]) {
      await expect(
        pool`
          insert into variances (id, recon_run_id, org_id, branch_id, aggregator_id, cause_code,
                                 expected_minor, actual_minor, delta_minor, currency, confidence, evidence)
          values (${randomUUID()}, ${runId}, ${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId},
                  'COMMISSION_RATE_MISMATCH', -2500, -3000, 500, 'AED', 1.0, ${pool.json(evidence as never)})
        `,
      ).rejects.toThrow(/variances_evidence_has_/);
    }
  });

  it('rejects a delta that does not follow from the amounts', async () => {
    const { id, evidence } = varianceValues({
      source_row_ids: [fx.sourceRowAId],
      rule: 'r',
      computation: 'c',
      inputs: {},
    });

    await expect(
      pool`
        insert into variances (id, recon_run_id, org_id, branch_id, aggregator_id, cause_code,
                               expected_minor, actual_minor, delta_minor, currency, confidence, evidence)
        values (${id}, ${runId}, ${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId},
                'COMMISSION_RATE_MISMATCH', -2500, -3000, 99999, 'AED', 1.0, ${pool.json(evidence as never)})
      `,
    ).rejects.toThrow(/variances_delta_consistent/);
  });

  it('rejects an evidence blob that is not an object at all', async () => {
    // A CHECK whose expression evaluates to NULL passes, so a jsonb string here
    // would sail through a naively-written lineage constraint. This is the case
    // that catches that.
    await expect(
      pool`
        insert into variances (id, recon_run_id, org_id, branch_id, aggregator_id, cause_code,
                               expected_minor, actual_minor, delta_minor, currency, confidence, evidence)
        values (${randomUUID()}, ${runId}, ${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId},
                'COMMISSION_RATE_MISMATCH', -2500, -3000, 500, 'AED', 1.0,
                ${'"not an object"'}::jsonb)
      `,
      // Any of the evidence constraints may fire first; what matters is that
      // one of them does rather than the row being accepted.
    ).rejects.toThrow(/variances_evidence_/);
  });

  it('rejects a cause code that is not in the taxonomy', async () => {
    const { id, evidence } = varianceValues({
      source_row_ids: [fx.sourceRowAId],
      rule: 'r',
      computation: 'c',
      inputs: {},
    });

    await expect(
      pool`
        insert into variances (id, recon_run_id, org_id, branch_id, aggregator_id, cause_code,
                               expected_minor, actual_minor, delta_minor, currency, confidence, evidence)
        values (${id}, ${runId}, ${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId},
                'INVENTED_CODE', 0, -1, 1, 'AED', 1.0, ${pool.json(evidence as never)})
      `,
    ).rejects.toThrow();
  });
});

describe('the payout sign convention', () => {
  let payoutId: string;

  beforeAll(async () => {
    payoutId = randomUUID();
    await pool`
      insert into payouts (id, org_id, branch_id, aggregator_id, external_payout_id,
                           period_start, period_end, currency, source_document_id, source_row_id)
      values (${payoutId}, ${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId}, 'PAY-1',
              '2025-03-01', '2025-03-15', 'AED', ${fx.sourceDocAId}, ${fx.sourceRowAId})
    `;
  });

  it('accepts a negative commission', async () => {
    await pool`
      insert into payout_lines (org_id, payout_id, line_type, amount_minor, currency, source_row_id)
      values (${fx.orgAId}, ${payoutId}, 'commission', -2500, 'AED', ${fx.sourceRowAId})
    `;
    const rows = await pool`select id from payout_lines where payout_id = ${payoutId}`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('rejects a positive commission rather than silently negating it', async () => {
    await expect(
      pool`
        insert into payout_lines (org_id, payout_id, line_type, amount_minor, currency, source_row_id)
        values (${fx.orgAId}, ${payoutId}, 'commission', 2500, 'AED', ${fx.sourceRowAId})
      `,
    ).rejects.toThrow(/payout_lines_deductions_negative/);
  });

  it('rejects a negative gross sale', async () => {
    await expect(
      pool`
        insert into payout_lines (org_id, payout_id, line_type, amount_minor, currency, source_row_id)
        values (${fx.orgAId}, ${payoutId}, 'gross_sale', -100, 'AED', ${fx.sourceRowAId})
      `,
    ).rejects.toThrow(/payout_lines_sales_positive/);
  });
});

describe('commission rate history', () => {
  it('refuses two overlapping periods for the same branch and aggregator', async () => {
    // An ambiguous rate produces a commission variance nobody can defend.
    await pool`
      insert into branch_aggregator_accounts
        (org_id, branch_id, aggregator_id, external_store_id, contracted_commission_rate,
         effective_from, effective_to)
      values (${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId}, 'STORE-1', 0.2500,
              '2025-01-01', '2025-06-01')
    `;

    await expect(
      pool`
        insert into branch_aggregator_accounts
          (org_id, branch_id, aggregator_id, external_store_id, contracted_commission_rate,
           effective_from, effective_to)
        values (${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId}, 'STORE-1', 0.3000,
                '2025-03-01', null)
      `,
    ).rejects.toThrow(/baa_no_overlapping_periods/);
  });

  it('allows an adjacent period starting where the previous one ends', async () => {
    await pool`
      insert into branch_aggregator_accounts
        (org_id, branch_id, aggregator_id, external_store_id, contracted_commission_rate,
         effective_from, effective_to)
      values (${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId}, 'STORE-1', 0.3000,
              '2025-06-01', null)
    `;

    const rows = await pool`
      select id from branch_aggregator_accounts where branch_id = ${fx.branchAId}
    `;
    expect(rows).toHaveLength(2);
  });
});

describe('checksum deduplication', () => {
  it('refuses a second document with the same checksum in the same organisation', async () => {
    // Restaurants forward the same email twice constantly, and a duplicate must
    // not double-count a month's commission.
    const checksum = `dup-${randomUUID()}`;

    await pool`
      insert into source_documents (org_id, branch_id, aggregator_id, kind, storage_path,
                                    received_via, checksum)
      values (${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId}, 'payout_statement', 'a.csv',
              'email', ${checksum})
    `;

    await expect(
      pool`
        insert into source_documents (org_id, branch_id, aggregator_id, kind, storage_path,
                                      received_via, checksum)
        values (${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId}, 'payout_statement', 'b.csv',
                'email', ${checksum})
      `,
    ).rejects.toThrow(/source_documents_checksum_idx/);
  });

  it('allows the same checksum in a different organisation', async () => {
    // Two customers uploading the same aggregator template must not collide.
    const checksum = `shared-${randomUUID()}`;

    await pool`
      insert into source_documents (org_id, branch_id, aggregator_id, kind, storage_path,
                                    received_via, checksum)
      values (${fx.orgAId}, ${fx.branchAId}, ${fx.aggregatorId}, 'payout_statement', 'a.csv',
              'upload', ${checksum})
    `;
    await pool`
      insert into source_documents (org_id, branch_id, aggregator_id, kind, storage_path,
                                    received_via, checksum)
      values (${fx.orgBId}, ${fx.branchBId}, ${fx.aggregatorId}, 'payout_statement', 'a.csv',
              'upload', ${checksum})
    `;

    const rows = await pool`select id from source_documents where checksum = ${checksum}`;
    expect(rows).toHaveLength(2);
  });
});

describe('cause code reference data', () => {
  it('matches the taxonomy the engine emits', async () => {
    const { CAUSE_CODES } = await import('@aggregatoriq/core');
    const rows = await pool<{ code: string; counts_towards_recovery: boolean }[]>`
      select code, counts_towards_recovery from cause_codes order by code
    `;

    expect(rows.map((row) => row.code)).toEqual(
      [...CAUSE_CODES].map((cause) => cause.code).sort(),
    );

    for (const row of rows) {
      const cause = CAUSE_CODES.find((candidate) => candidate.code === row.code)!;
      expect(row.counts_towards_recovery, row.code).toBe(cause.countsTowardsRecovery);
    }
  });
});
