/**
 * Analytics events and the north-star metric.
 *
 * The north star is median monthly recovery identified per active branch, as a
 * multiple of subscription price. Above five times the business works; below
 * three, churn arrives within four months regardless of how good the software
 * is. `recoveryMultiple` computes it, and it uses the median rather than the
 * mean deliberately — one chain with a huge recovery would otherwise hide a
 * hundred branches finding nothing.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { analyticsEvents, branches, reconRuns } from '../schema.js';

export const ANALYTICS_EVENTS = [
  'audit_uploaded',
  'audit_completed',
  'signup',
  'branch_connected',
  'ingestion_email_used',
  'recon_run_completed',
  'variance_viewed',
  'dispute_pack_generated',
  'dispute_outcome_recorded',
  'subscribed',
  'churned',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export async function track(
  tx: Transaction,
  event: {
    name: AnalyticsEventName;
    orgId?: string | null;
    userId?: string | null;
    anonymousId?: string | null;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(analyticsEvents).values({
    name: event.name,
    orgId: event.orgId ?? null,
    userId: event.userId ?? null,
    anonymousId: event.anonymousId ?? null,
    properties: event.properties ?? {},
  });
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

export interface NorthStar {
  /** Median recovery identified per active branch, in minor units. */
  medianRecoveryPerBranchMinor: number | null;
  activeBranches: number;
  subscriptionPricePerBranchMinor: number;
  /** Recovery as a multiple of price. Above 5 the business works. */
  recoveryMultiple: number | null;
}

export async function northStar(
  tx: Transaction,
  input: { orgId: string; since: Date; subscriptionPricePerBranchMinor: number },
): Promise<NorthStar> {
  const rows = await tx
    .select({
      branchId: reconRuns.branchId,
      recovered: sql<number>`sum(${reconRuns.recoveryTotalMinor})::bigint`,
    })
    .from(reconRuns)
    .where(and(eq(reconRuns.orgId, input.orgId), gte(reconRuns.startedAt, input.since)))
    .groupBy(reconRuns.branchId);

  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(branches)
    .where(and(eq(branches.orgId, input.orgId), eq(branches.isActive, true)));

  const perBranch = rows.map((row) => Number(row.recovered));
  const medianRecovery = median(perBranch);

  return {
    medianRecoveryPerBranchMinor: medianRecovery,
    activeBranches: Number(count),
    subscriptionPricePerBranchMinor: input.subscriptionPricePerBranchMinor,
    recoveryMultiple:
      medianRecovery === null || input.subscriptionPricePerBranchMinor === 0
        ? null
        : Number((medianRecovery / input.subscriptionPricePerBranchMinor).toFixed(2)),
  };
}
