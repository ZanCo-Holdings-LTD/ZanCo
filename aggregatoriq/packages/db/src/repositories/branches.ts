/**
 * Brands, branches and the aggregator accounts hanging off them.
 *
 * The dated-rows pattern on `branch_aggregator_accounts` is the part worth
 * reading carefully. A commission rate is not a property of an account, it is a
 * property of an account *during a period*, and the engine judges a March order
 * against March's rate. A database exclusion constraint stops two periods
 * overlapping, because an ambiguous rate produces a commission variance nobody
 * can defend.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AggregatorCode, PlainDate, VatTreatment } from '@aggregatoriq/core';
import type { Transaction } from '../client.js';
import { aggregators, branchAggregatorAccounts, branches, brands } from '../schema.js';

export interface BranchRecord {
  id: string;
  orgId: string;
  brandId: string | null;
  brandName: string | null;
  name: string;
  city: string | null;
  timezone: string;
  currency: string;
  isActive: boolean;
}

export async function listBranches(tx: Transaction, orgId: string): Promise<BranchRecord[]> {
  const rows = await tx
    .select({
      id: branches.id,
      orgId: branches.orgId,
      brandId: branches.brandId,
      brandName: brands.name,
      name: branches.name,
      city: branches.city,
      timezone: branches.timezone,
      currency: branches.currency,
      isActive: branches.isActive,
    })
    .from(branches)
    .leftJoin(brands, eq(brands.id, branches.brandId))
    .where(and(eq(branches.orgId, orgId), isNull(branches.deletedAt)))
    .orderBy(asc(branches.name));

  return rows;
}

export async function getBranch(
  tx: Transaction,
  orgId: string,
  branchId: string,
): Promise<BranchRecord | null> {
  const rows = await tx
    .select({
      id: branches.id,
      orgId: branches.orgId,
      brandId: branches.brandId,
      brandName: brands.name,
      name: branches.name,
      city: branches.city,
      timezone: branches.timezone,
      currency: branches.currency,
      isActive: branches.isActive,
    })
    .from(branches)
    .leftJoin(brands, eq(brands.id, branches.brandId))
    .where(and(eq(branches.orgId, orgId), eq(branches.id, branchId), isNull(branches.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

export async function createBranch(
  tx: Transaction,
  input: {
    orgId: string;
    brandId?: string | null;
    name: string;
    city?: string | null;
    timezone: string;
    currency: string;
  },
): Promise<string> {
  const [created] = await tx
    .insert(branches)
    .values({
      orgId: input.orgId,
      brandId: input.brandId ?? null,
      name: input.name.trim(),
      city: input.city ?? null,
      timezone: input.timezone,
      currency: input.currency,
    })
    .returning({ id: branches.id });

  if (!created) throw new Error('Branch insert returned no row');
  return created.id;
}

export async function updateBranch(
  tx: Transaction,
  orgId: string,
  branchId: string,
  changes: {
    name?: string;
    city?: string | null;
    timezone?: string;
    currency?: string;
    brandId?: string | null;
    isActive?: boolean;
  },
): Promise<void> {
  await tx
    .update(branches)
    .set(changes)
    .where(and(eq(branches.orgId, orgId), eq(branches.id, branchId)));
}

/**
 * Soft delete.
 *
 * A branch's orders, payouts and reconciliation history are the evidence behind
 * any dispute already submitted, so removing the branch must not remove them.
 */
export async function deleteBranch(
  tx: Transaction,
  orgId: string,
  branchId: string,
): Promise<void> {
  await tx
    .update(branches)
    .set({ deletedAt: sql`now()`, isActive: false })
    .where(and(eq(branches.orgId, orgId), eq(branches.id, branchId)));
}

export async function listBrands(
  tx: Transaction,
  orgId: string,
): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.orgId, orgId))
    .orderBy(asc(brands.name));
}

export async function createBrand(
  tx: Transaction,
  orgId: string,
  name: string,
): Promise<string> {
  const [created] = await tx
    .insert(brands)
    .values({ orgId, name: name.trim() })
    .returning({ id: brands.id });
  if (!created) throw new Error('Brand insert returned no row');
  return created.id;
}

export async function listAggregators(
  tx: Transaction,
): Promise<{ id: string; code: AggregatorCode; name: string }[]> {
  return tx
    .select({ id: aggregators.id, code: aggregators.code, name: aggregators.name })
    .from(aggregators)
    .orderBy(asc(aggregators.name));
}

export interface AggregatorAccountRecord {
  id: string;
  orgId: string;
  branchId: string;
  aggregatorId: string;
  aggregatorCode: AggregatorCode;
  aggregatorName: string;
  externalStoreId: string;
  contractedCommissionRate: number;
  promoShareTerms: unknown;
  vatTreatment: VatTreatment;
  vatRate: number;
  payoutCycleDays: number;
  deliveryFeeBearer: 'aggregator' | 'operator' | 'customer';
  currency: string;
  effectiveFrom: PlainDate;
  effectiveTo: PlainDate | null;
  notes: string | null;
}

export async function listAggregatorAccounts(
  tx: Transaction,
  orgId: string,
  branchId?: string,
): Promise<AggregatorAccountRecord[]> {
  const where = branchId
    ? and(
        eq(branchAggregatorAccounts.orgId, orgId),
        eq(branchAggregatorAccounts.branchId, branchId),
      )
    : eq(branchAggregatorAccounts.orgId, orgId);

  const rows = await tx
    .select({
      id: branchAggregatorAccounts.id,
      orgId: branchAggregatorAccounts.orgId,
      branchId: branchAggregatorAccounts.branchId,
      aggregatorId: branchAggregatorAccounts.aggregatorId,
      aggregatorCode: aggregators.code,
      aggregatorName: aggregators.name,
      externalStoreId: branchAggregatorAccounts.externalStoreId,
      contractedCommissionRate: branchAggregatorAccounts.contractedCommissionRate,
      promoShareTerms: branchAggregatorAccounts.promoShareTerms,
      vatTreatment: branchAggregatorAccounts.vatTreatment,
      vatRate: branchAggregatorAccounts.vatRate,
      payoutCycleDays: branchAggregatorAccounts.payoutCycleDays,
      deliveryFeeBearer: branchAggregatorAccounts.deliveryFeeBearer,
      currency: branchAggregatorAccounts.currency,
      effectiveFrom: branchAggregatorAccounts.effectiveFrom,
      effectiveTo: branchAggregatorAccounts.effectiveTo,
      notes: branchAggregatorAccounts.notes,
    })
    .from(branchAggregatorAccounts)
    .innerJoin(aggregators, eq(aggregators.id, branchAggregatorAccounts.aggregatorId))
    .where(where)
    .orderBy(asc(aggregators.name), desc(branchAggregatorAccounts.effectiveFrom));

  // numeric columns arrive as strings from postgres-js; a rate is arithmetic
  // input, so it is converted once here rather than at each call site.
  return rows.map((row) => ({
    ...row,
    contractedCommissionRate: Number(row.contractedCommissionRate),
    vatRate: Number(row.vatRate),
  }));
}

export async function createAggregatorAccount(
  tx: Transaction,
  input: {
    orgId: string;
    branchId: string;
    aggregatorId: string;
    externalStoreId: string;
    contractedCommissionRate: number;
    promoShareTerms?: unknown;
    vatTreatment?: VatTreatment;
    vatRate?: number;
    payoutCycleDays?: number;
    deliveryFeeBearer?: 'aggregator' | 'operator' | 'customer';
    currency?: string;
    effectiveFrom: PlainDate;
    effectiveTo?: PlainDate | null;
    notes?: string | null;
  },
): Promise<string> {
  const [created] = await tx
    .insert(branchAggregatorAccounts)
    .values({
      orgId: input.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
      externalStoreId: input.externalStoreId.trim(),
      contractedCommissionRate: input.contractedCommissionRate.toFixed(4),
      promoShareTerms: input.promoShareTerms ?? { terms: [], defaultAggregatorSharePct: 0 },
      vatTreatment: input.vatTreatment ?? 'commission_on_net',
      vatRate: (input.vatRate ?? 0.05).toFixed(4),
      payoutCycleDays: input.payoutCycleDays ?? 14,
      deliveryFeeBearer: input.deliveryFeeBearer ?? 'customer',
      currency: input.currency ?? 'AED',
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: branchAggregatorAccounts.id });

  if (!created) throw new Error('Aggregator account insert returned no row');
  return created.id;
}

/**
 * Close the current period and open a new one.
 *
 * A rate change is never an update in place: the old row keeps its dates so that
 * historical reconciliations continue to reproduce, and the new rate applies
 * from its own effective date forward.
 */
export async function supersedeAggregatorAccount(
  tx: Transaction,
  input: {
    orgId: string;
    accountId: string;
    effectiveFrom: PlainDate;
    contractedCommissionRate: number;
    promoShareTerms?: unknown;
    vatTreatment?: VatTreatment;
    vatRate?: number;
    payoutCycleDays?: number;
    deliveryFeeBearer?: 'aggregator' | 'operator' | 'customer';
    notes?: string | null;
  },
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(branchAggregatorAccounts)
    .where(
      and(
        eq(branchAggregatorAccounts.orgId, input.orgId),
        eq(branchAggregatorAccounts.id, input.accountId),
      ),
    )
    .limit(1);

  if (!existing) throw new Error(`Aggregator account ${input.accountId} not found`);

  await tx
    .update(branchAggregatorAccounts)
    .set({ effectiveTo: input.effectiveFrom })
    .where(eq(branchAggregatorAccounts.id, existing.id));

  return createAggregatorAccount(tx, {
    orgId: existing.orgId,
    branchId: existing.branchId,
    aggregatorId: existing.aggregatorId,
    externalStoreId: existing.externalStoreId,
    contractedCommissionRate: input.contractedCommissionRate,
    promoShareTerms: input.promoShareTerms ?? existing.promoShareTerms,
    vatTreatment: input.vatTreatment ?? existing.vatTreatment,
    vatRate: input.vatRate ?? Number(existing.vatRate),
    payoutCycleDays: input.payoutCycleDays ?? existing.payoutCycleDays,
    deliveryFeeBearer: input.deliveryFeeBearer ?? existing.deliveryFeeBearer,
    currency: existing.currency,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    notes: input.notes ?? null,
  });
}
