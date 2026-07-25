/**
 * Running a reconciliation.
 *
 * This is glue: load canonical data, hand it to the pure engine, persist what
 * comes back. There is deliberately no arithmetic here. Every number a customer
 * sees is produced by `@aggregatoriq/engine`, which is testable against fixtures
 * and has no database, so a change to this file cannot alter a figure.
 */
import type { Currency, Period } from '@aggregatoriq/core';
import { materiality, reconcile, type ReconcileResult } from '@aggregatoriq/engine';
import type { AggregatorAccountConfig } from '@aggregatoriq/engine';
import { repositories, withoutTenantScope, type Database } from '@aggregatoriq/db';
import { today } from '@aggregatoriq/core';

export interface RunReconciliationInput {
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregatorId: string;
  readonly period: Period;
  readonly currency: Currency;
  readonly materialityThresholdMinor: number;
  readonly triggeredBy: string | null;
  /** Passed in so a run is reproducible in a test rather than reading a clock. */
  readonly asOf?: string;
}

export interface RunReconciliationOutput {
  readonly reconRunId: string;
  readonly result: ReconcileResult;
}

export async function runReconciliation(
  db: Database,
  input: RunReconciliationInput,
): Promise<RunReconciliationOutput> {
  const { orders, payouts, configs } = await withoutTenantScope(db, async (tx) => {
    const [loadedOrders, loadedPayouts, accounts] = await Promise.all([
      repositories.canonical.loadOrdersForPeriod(tx, {
        orgId: input.orgId,
        branchId: input.branchId,
        aggregatorId: input.aggregatorId,
        period: input.period,
      }),
      repositories.canonical.loadPayoutsForPeriod(tx, {
        orgId: input.orgId,
        branchId: input.branchId,
        aggregatorId: input.aggregatorId,
        period: input.period,
      }),
      repositories.branches.listAggregatorAccounts(tx, input.orgId, input.branchId),
    ]);

    return { orders: loadedOrders, payouts: loadedPayouts, configs: accounts };
  });

  const engineConfigs: AggregatorAccountConfig[] = configs
    .filter((account) => account.aggregatorId === input.aggregatorId)
    .map((account) => ({
      id: account.id,
      orgId: account.orgId,
      branchId: account.branchId,
      aggregatorId: account.aggregatorId,
      aggregatorCode: account.aggregatorCode,
      externalStoreId: account.externalStoreId,
      contractedCommissionRate: account.contractedCommissionRate,
      promoShareTerms: normalisePromoTerms(account.promoShareTerms),
      vatTreatment: account.vatTreatment,
      vatRate: account.vatRate,
      payoutCycleDays: account.payoutCycleDays,
      deliveryFeeBearer: account.deliveryFeeBearer,
      currency: account.currency as Currency,
      effectiveFrom: account.effectiveFrom,
      effectiveTo: account.effectiveTo,
    }));

  const result = reconcile({
    orgId: input.orgId,
    branchId: input.branchId,
    aggregatorId: input.aggregatorId,
    period: input.period,
    currency: input.currency,
    orders,
    payouts,
    configs: engineConfigs,
    materiality: materiality(input.materialityThresholdMinor, input.currency),
    asOf: input.asOf ?? today(),
  });

  const reconRunId = await withoutTenantScope(db, (tx) =>
    repositories.recon.persistReconRun(tx, {
      orgId: input.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
      period: input.period,
      currency: input.currency,
      materialityThresholdMinor: input.materialityThresholdMinor,
      triggeredBy: input.triggeredBy,
      result,
    }),
  );

  await withoutTenantScope(db, (tx) =>
    repositories.analytics.track(tx, {
      name: 'recon_run_completed',
      orgId: input.orgId,
      userId: input.triggeredBy,
      properties: {
        branchId: input.branchId,
        aggregatorId: input.aggregatorId,
        varianceCount: result.variances.length,
        recoveryTotalMinor: result.recoveryTotalMinor,
        unmatchedLineCount: result.unmatched.length,
        engineVersion: result.engineVersion,
      },
    }),
  );

  return { reconRunId, result };
}

/**
 * Coerce the stored promo terms into the shape the engine expects.
 *
 * The column is jsonb and therefore whatever was written into it. A malformed
 * blob becomes "the aggregator funds nothing", which is the conservative
 * reading — it under-claims rather than manufacturing a promo variance out of a
 * configuration mistake.
 */
function normalisePromoTerms(value: unknown): AggregatorAccountConfig['promoShareTerms'] {
  const fallback = { terms: [], defaultAggregatorSharePct: 0 };
  if (typeof value !== 'object' || value === null) return fallback;

  const record = value as Record<string, unknown>;
  const rawTerms = Array.isArray(record.terms) ? record.terms : [];

  const terms = rawTerms.flatMap((term) => {
    if (typeof term !== 'object' || term === null) return [];
    const entry = term as Record<string, unknown>;
    const promoType = typeof entry.promoType === 'string' ? entry.promoType : null;
    const share = Number(entry.aggregatorSharePct);
    if (promoType === null || !Number.isFinite(share) || share < 0 || share > 1) return [];
    return [{ promoType, aggregatorSharePct: share }];
  });

  const defaultShare = Number(record.defaultAggregatorSharePct);

  return {
    terms,
    defaultAggregatorSharePct:
      Number.isFinite(defaultShare) && defaultShare >= 0 && defaultShare <= 1 ? defaultShare : 0,
  };
}
