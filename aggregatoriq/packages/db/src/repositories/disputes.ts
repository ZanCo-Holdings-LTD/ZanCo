/**
 * Disputes.
 *
 * Outcomes feed the dispute success dataset, which is why `recovered_minor` is
 * recorded separately from `claimed_minor` rather than assumed equal on
 * acceptance. Over time, "which cause codes actually get paid" is the most
 * valuable thing this product knows, and it can only be learned if partial
 * acceptances are recorded honestly.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Currency, DisputeOutcome } from '@aggregatoriq/core';
import type { Transaction } from '../client.js';
import { disputes, variances } from '../schema.js';

export interface DisputeRecord {
  id: string;
  branchId: string | null;
  aggregatorId: string;
  reference: string;
  varianceIds: string[];
  claimedMinor: number;
  currency: string;
  packDocumentPath: string | null;
  submittedAt: Date | null;
  externalReference: string | null;
  outcome: DisputeOutcome;
  recoveredMinor: number;
  notes: string | null;
  createdAt: Date;
}

/**
 * Create a dispute from a set of variances.
 *
 * The claimed amount is recomputed from the variances rather than taken from the
 * caller, so the number in the pack is the number the engine produced and cannot
 * drift from it through a UI bug.
 */
export async function createDispute(
  tx: Transaction,
  input: {
    orgId: string;
    branchId: string | null;
    aggregatorId: string;
    reference: string;
    varianceIds: readonly string[];
    currency: Currency;
    notes?: string | null;
    createdBy: string | null;
  },
): Promise<{ id: string; claimedMinor: number }> {
  if (input.varianceIds.length === 0) {
    throw new Error('A dispute must contain at least one variance');
  }

  const rows = await tx
    .select({ id: variances.id, deltaMinor: variances.deltaMinor })
    .from(variances)
    .where(
      and(eq(variances.orgId, input.orgId), inArray(variances.id, [...input.varianceIds])),
    );

  if (rows.length !== input.varianceIds.length) {
    throw new Error(
      `Dispute references ${input.varianceIds.length} variances but only ${rows.length} are ` +
        `visible to this organisation`,
    );
  }

  const claimedMinor = rows.reduce((total, row) => total + Number(row.deltaMinor), 0);

  const [created] = await tx
    .insert(disputes)
    .values({
      orgId: input.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
      reference: input.reference,
      varianceIds: [...input.varianceIds],
      claimedMinor,
      currency: input.currency,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: disputes.id });

  if (!created) throw new Error('Dispute insert returned no row');

  await tx
    .update(variances)
    .set({ status: 'disputed' })
    .where(and(eq(variances.orgId, input.orgId), inArray(variances.id, [...input.varianceIds])));

  return { id: created.id, claimedMinor };
}

export async function markDisputeSubmitted(
  tx: Transaction,
  orgId: string,
  disputeId: string,
  externalReference: string | null,
  packDocumentPath: string | null,
): Promise<void> {
  await tx
    .update(disputes)
    .set({ submittedAt: sql`now()`, externalReference, packDocumentPath })
    .where(and(eq(disputes.orgId, orgId), eq(disputes.id, disputeId)));
}

/**
 * Record the outcome and push it back onto the variances.
 *
 * A rejected dispute returns its variances to `open` rather than closing them:
 * a rejection is frequently a request for more evidence, and burying the finding
 * would lose a claim that is still valid.
 */
export async function recordDisputeOutcome(
  tx: Transaction,
  input: {
    orgId: string;
    disputeId: string;
    outcome: DisputeOutcome;
    recoveredMinor: number;
    notes?: string | null;
  },
): Promise<void> {
  const [dispute] = await tx
    .select({ varianceIds: disputes.varianceIds })
    .from(disputes)
    .where(and(eq(disputes.orgId, input.orgId), eq(disputes.id, input.disputeId)))
    .limit(1);

  if (!dispute) throw new Error(`Dispute ${input.disputeId} not found`);

  await tx
    .update(disputes)
    .set({
      outcome: input.outcome,
      recoveredMinor: input.recoveredMinor,
      outcomeRecordedAt: sql`now()`,
      notes: input.notes ?? null,
    })
    .where(and(eq(disputes.orgId, input.orgId), eq(disputes.id, input.disputeId)));

  const varianceStatus =
    input.outcome === 'accepted' || input.outcome === 'partially_accepted'
      ? 'recovered'
      : input.outcome === 'rejected'
        ? 'open'
        : 'disputed';

  if (dispute.varianceIds.length > 0) {
    await tx
      .update(variances)
      .set({ status: varianceStatus })
      .where(
        and(eq(variances.orgId, input.orgId), inArray(variances.id, dispute.varianceIds)),
      );
  }
}

export async function listDisputes(
  tx: Transaction,
  orgId: string,
  filters: { branchId?: string; outcome?: DisputeOutcome } = {},
): Promise<DisputeRecord[]> {
  const conditions = [eq(disputes.orgId, orgId)];
  if (filters.branchId) conditions.push(eq(disputes.branchId, filters.branchId));
  if (filters.outcome) conditions.push(eq(disputes.outcome, filters.outcome));

  const rows = await tx
    .select()
    .from(disputes)
    .where(and(...conditions))
    .orderBy(desc(disputes.createdAt));

  return rows.map((row) => ({
    id: row.id,
    branchId: row.branchId,
    aggregatorId: row.aggregatorId,
    reference: row.reference,
    varianceIds: row.varianceIds,
    claimedMinor: Number(row.claimedMinor),
    currency: row.currency,
    packDocumentPath: row.packDocumentPath,
    submittedAt: row.submittedAt,
    externalReference: row.externalReference,
    outcome: row.outcome,
    recoveredMinor: Number(row.recoveredMinor),
    notes: row.notes,
    createdAt: row.createdAt,
  }));
}

export async function getDispute(
  tx: Transaction,
  orgId: string,
  disputeId: string,
): Promise<DisputeRecord | null> {
  const rows = await listDisputes(tx, orgId);
  return rows.find((row) => row.id === disputeId) ?? null;
}

/** Recovered to date — the second headline number on the dashboard. */
export async function totalRecovered(
  tx: Transaction,
  orgId: string,
): Promise<{ recoveredMinor: number; claimedMinor: number; disputeCount: number }> {
  const [row] = await tx
    .select({
      recoveredMinor: sql<number>`coalesce(sum(${disputes.recoveredMinor}), 0)::bigint`,
      claimedMinor: sql<number>`coalesce(sum(${disputes.claimedMinor}), 0)::bigint`,
      disputeCount: sql<number>`count(*)::int`,
    })
    .from(disputes)
    .where(eq(disputes.orgId, orgId));

  return {
    recoveredMinor: Number(row?.recoveredMinor ?? 0),
    claimedMinor: Number(row?.claimedMinor ?? 0),
    disputeCount: Number(row?.disputeCount ?? 0),
  };
}
