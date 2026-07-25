/**
 * Persisting a reconciliation run.
 *
 * The derived layer is safe to throw away and rebuild — that is what makes it
 * the derived layer — so a re-run of a period replaces its predecessor's
 * findings rather than accumulating them. What survives a re-run is the human
 * judgement: a variance somebody dismissed, or attached to a dispute, keeps that
 * status, because losing it would mean an analyst re-triaging the same hundred
 * findings every time a statement arrives.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ReconcileResult } from '@aggregatoriq/engine';
import type { Currency, Period, PlainDate, VarianceStatus } from '@aggregatoriq/core';
import type { Transaction } from '../client.js';
import { matches, reconRuns, unmatchedLines, variances } from '../schema.js';

export interface PersistRunInput {
  orgId: string;
  branchId: string;
  aggregatorId: string;
  period: Period;
  currency: Currency;
  materialityThresholdMinor: number;
  triggeredBy: string | null;
  result: ReconcileResult;
}

export async function persistReconRun(
  tx: Transaction,
  input: PersistRunInput,
): Promise<string> {
  const { result } = input;

  const [run] = await tx
    .insert(reconRuns)
    .values({
      orgId: input.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      engineVersion: result.engineVersion,
      ruleSetVersion: result.ruleSetVersion,
      runKey: result.runKey,
      materialityThresholdMinor: input.materialityThresholdMinor,
      currency: input.currency,
      status: 'completed',
      finishedAt: sql`now()`,
      orderCount: result.stats.orderCount,
      payoutLineCount: result.stats.payoutLineCount,
      varianceCount: result.variances.length,
      unmatchedLineCount: result.unmatched.length,
      recoveryTotalMinor: result.recoveryTotalMinor,
      warnings: result.warnings,
      triggeredBy: input.triggeredBy,
    })
    .returning({ id: reconRuns.id });

  if (!run) throw new Error('Recon run insert returned no row');

  if (result.matches.length > 0) {
    await tx.insert(matches).values(
      result.matches.map((match) => ({
        orgId: input.orgId,
        reconRunId: run.id,
        orderId: match.orderId,
        payoutLineIds: [...match.payoutLineIds],
        method: match.method,
        confidence: match.confidence.toFixed(3),
      })),
    );
  }

  if (result.unmatched.length > 0) {
    await tx.insert(unmatchedLines).values(
      result.unmatched.map((line) => ({
        orgId: input.orgId,
        reconRunId: run.id,
        payoutLineId: line.payoutLineId,
        reason: line.reason,
      })),
    );
  }

  if (result.variances.length > 0) {
    // The variance id is deterministic, so a re-run of an unchanged period
    // collides on the primary key. That collision is the mechanism: it carries
    // the human's status forward instead of resurrecting a dismissed finding.
    const previousStatuses = await tx
      .select({ id: variances.id, status: variances.status, dismissedReason: variances.dismissedReason })
      .from(variances)
      .where(
        inArray(
          variances.id,
          result.variances.map((variance) => variance.id),
        ),
      );

    const carried = new Map(previousStatuses.map((row) => [row.id, row]));

    await tx
      .insert(variances)
      .values(
        result.variances.map((variance) => {
          const previous = carried.get(variance.id);
          return {
            id: variance.id,
            reconRunId: run.id,
            orgId: variance.orgId,
            branchId: variance.branchId,
            aggregatorId: variance.aggregatorId,
            orderId: variance.orderId,
            causeCode: variance.causeCode,
            expectedMinor: variance.expectedMinor,
            actualMinor: variance.actualMinor,
            deltaMinor: variance.deltaMinor,
            currency: variance.currency,
            confidence: variance.confidence.toFixed(3),
            // Stored snake_case to match the database constraint that checks
            // evidence -> 'source_row_ids'.
            evidence: {
              source_row_ids: variance.evidence.sourceRowIds,
              rule: variance.evidence.rule,
              computation: variance.evidence.computation,
              inputs: variance.evidence.inputs,
              match_method: variance.evidence.matchMethod ?? null,
              match_confidence: variance.evidence.matchConfidence ?? null,
            },
            status: previous?.status ?? 'open',
            dismissedReason: previous?.dismissedReason ?? null,
          };
        }),
      )
      .onConflictDoUpdate({
        target: variances.id,
        set: {
          reconRunId: sql`excluded.recon_run_id`,
          expectedMinor: sql`excluded.expected_minor`,
          actualMinor: sql`excluded.actual_minor`,
          deltaMinor: sql`excluded.delta_minor`,
          confidence: sql`excluded.confidence`,
          evidence: sql`excluded.evidence`,
        },
      });
  }

  return run.id;
}

export async function markRunFailed(
  tx: Transaction,
  runId: string,
  error: string,
): Promise<void> {
  await tx
    .update(reconRuns)
    .set({ status: 'failed', error, finishedAt: sql`now()` })
    .where(eq(reconRuns.id, runId));
}

export interface ReconRunSummary {
  id: string;
  branchId: string;
  aggregatorId: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  engineVersion: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  varianceCount: number;
  unmatchedLineCount: number;
  recoveryTotalMinor: number;
  currency: string;
  warnings: unknown;
}

export async function listReconRuns(
  tx: Transaction,
  orgId: string,
  filters: { branchId?: string; limit?: number } = {},
): Promise<ReconRunSummary[]> {
  const conditions = [eq(reconRuns.orgId, orgId)];
  if (filters.branchId) conditions.push(eq(reconRuns.branchId, filters.branchId));

  const rows = await tx
    .select()
    .from(reconRuns)
    .where(and(...conditions))
    .orderBy(desc(reconRuns.startedAt))
    .limit(filters.limit ?? 50);

  return rows.map((row) => ({
    id: row.id,
    branchId: row.branchId,
    aggregatorId: row.aggregatorId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    engineVersion: row.engineVersion,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    varianceCount: row.varianceCount,
    unmatchedLineCount: row.unmatchedLineCount,
    recoveryTotalMinor: Number(row.recoveryTotalMinor),
    currency: row.currency,
    warnings: row.warnings,
  }));
}

export async function getReconRun(
  tx: Transaction,
  orgId: string,
  runId: string,
): Promise<ReconRunSummary | null> {
  const rows = await listReconRuns(tx, orgId);
  return rows.find((row) => row.id === runId) ?? null;
}

export interface VarianceRecord {
  id: string;
  reconRunId: string;
  branchId: string;
  aggregatorId: string;
  orderId: string | null;
  causeCode: string;
  expectedMinor: number;
  actualMinor: number;
  deltaMinor: number;
  currency: string;
  confidence: number;
  evidence: {
    source_row_ids: string[];
    rule: string;
    computation: string;
    inputs: Record<string, unknown>;
    match_method?: string | null;
    match_confidence?: number | null;
  };
  status: VarianceStatus;
  dismissedReason: string | null;
}

export async function listVariances(
  tx: Transaction,
  orgId: string,
  filters: { reconRunId?: string; branchId?: string; causeCode?: string; status?: VarianceStatus } = {},
): Promise<VarianceRecord[]> {
  const conditions = [eq(variances.orgId, orgId)];
  if (filters.reconRunId) conditions.push(eq(variances.reconRunId, filters.reconRunId));
  if (filters.branchId) conditions.push(eq(variances.branchId, filters.branchId));
  if (filters.causeCode) conditions.push(eq(variances.causeCode, filters.causeCode));
  if (filters.status) conditions.push(eq(variances.status, filters.status));

  const rows = await tx
    .select()
    .from(variances)
    .where(and(...conditions))
    .orderBy(desc(variances.deltaMinor));

  return rows.map(toVarianceRecord);
}

export async function getVariance(
  tx: Transaction,
  orgId: string,
  varianceId: string,
): Promise<VarianceRecord | null> {
  const [row] = await tx
    .select()
    .from(variances)
    .where(and(eq(variances.orgId, orgId), eq(variances.id, varianceId)))
    .limit(1);
  return row ? toVarianceRecord(row) : null;
}

export async function setVarianceStatus(
  tx: Transaction,
  orgId: string,
  varianceIds: readonly string[],
  status: VarianceStatus,
  dismissedReason: string | null = null,
): Promise<number> {
  if (varianceIds.length === 0) return 0;

  const updated = await tx
    .update(variances)
    .set({ status, dismissedReason })
    .where(and(eq(variances.orgId, orgId), inArray(variances.id, [...varianceIds])))
    .returning({ id: variances.id });

  return updated.length;
}

export interface RecoverySummaryRow {
  causeCode: string;
  count: number;
  totalDeltaMinor: number;
}

export async function summariseVariancesByCause(
  tx: Transaction,
  orgId: string,
  filters: { reconRunId?: string; branchId?: string } = {},
): Promise<RecoverySummaryRow[]> {
  const conditions = [eq(variances.orgId, orgId)];
  if (filters.reconRunId) conditions.push(eq(variances.reconRunId, filters.reconRunId));
  if (filters.branchId) conditions.push(eq(variances.branchId, filters.branchId));

  const rows = await tx
    .select({
      causeCode: variances.causeCode,
      count: sql<number>`count(*)::int`,
      totalDeltaMinor: sql<number>`sum(${variances.deltaMinor})::bigint`,
    })
    .from(variances)
    .where(and(...conditions))
    .groupBy(variances.causeCode);

  return rows
    .map((row) => ({
      causeCode: row.causeCode,
      count: Number(row.count),
      totalDeltaMinor: Number(row.totalDeltaMinor),
    }))
    .sort((a, b) => b.totalDeltaMinor - a.totalDeltaMinor);
}

function toVarianceRecord(row: typeof variances.$inferSelect): VarianceRecord {
  return {
    id: row.id,
    reconRunId: row.reconRunId,
    branchId: row.branchId,
    aggregatorId: row.aggregatorId,
    orderId: row.orderId,
    causeCode: row.causeCode,
    expectedMinor: Number(row.expectedMinor),
    actualMinor: Number(row.actualMinor),
    deltaMinor: Number(row.deltaMinor),
    currency: row.currency,
    confidence: Number(row.confidence),
    evidence: row.evidence as VarianceRecord['evidence'],
    status: row.status,
    dismissedReason: row.dismissedReason,
  };
}
