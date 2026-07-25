import { eq, sql } from 'drizzle-orm';
import type { StructuringUsage } from '@fieldnote/shared';
import { structuringCostUsd, transcriptionCostUsd } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { reportCosts, subscriptions } from '../schema/billing.js';

export async function getSubscription(db: Database, orgId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);
  return row ?? null;
}

export async function upsertSubscription(
  db: Database,
  orgId: string,
  patch: Partial<typeof subscriptions.$inferInsert>,
): Promise<void> {
  await db
    .insert(subscriptions)
    .values({ orgId, ...patch })
    .onConflictDoUpdate({ target: subscriptions.orgId, set: patch });
}

export async function findByStripeCustomer(db: Database, customerId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);
  return row ?? null;
}

/** Whether the org may still use the product: active, or inside its trial. */
export function isEntitled(
  subscription: { status: string; trialEndsAt: Date | null } | null,
): boolean {
  if (!subscription) return false;
  if (subscription.status === 'active' || subscription.status === 'past_due') return true;
  if (subscription.status === 'trialing') {
    return subscription.trialEndsAt === null || subscription.trialEndsAt > new Date();
  }
  return false;
}

/**
 * Accumulate inference spend for a report.
 *
 * Additive rather than overwriting, because a report is structured section by
 * section and transcribed capture by capture. Instrumented from the first AI
 * milestone so cost-per-report is a number we watch, not one we discover in a
 * monthly invoice.
 */
export async function addStructuringCost(
  db: Database,
  orgId: string,
  reportId: string,
  usage: StructuringUsage,
): Promise<void> {
  const usd = structuringCostUsd(usage);
  await db
    .insert(reportCosts)
    .values({
      orgId,
      reportId,
      structuringUsd: usd.toFixed(6),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
    })
    .onConflictDoUpdate({
      target: reportCosts.reportId,
      set: {
        structuringUsd: sql`${reportCosts.structuringUsd} + ${usd.toFixed(6)}`,
        inputTokens: sql`${reportCosts.inputTokens} + ${usage.inputTokens}`,
        outputTokens: sql`${reportCosts.outputTokens} + ${usage.outputTokens}`,
        cachedInputTokens: sql`${reportCosts.cachedInputTokens} + ${usage.cacheReadInputTokens + usage.cacheCreationInputTokens}`,
      },
    });
}

export async function addTranscriptionCost(
  db: Database,
  orgId: string,
  reportId: string,
  durationMs: number,
): Promise<void> {
  const usd = transcriptionCostUsd(durationMs);
  await db
    .insert(reportCosts)
    .values({
      orgId,
      reportId,
      transcriptionUsd: usd.toFixed(6),
      audioMs: durationMs,
    })
    .onConflictDoUpdate({
      target: reportCosts.reportId,
      set: {
        transcriptionUsd: sql`${reportCosts.transcriptionUsd} + ${usd.toFixed(6)}`,
        audioMs: sql`${reportCosts.audioMs} + ${durationMs}`,
      },
    });
}

export async function reportCost(db: Database, reportId: string) {
  const [row] = await db
    .select()
    .from(reportCosts)
    .where(eq(reportCosts.reportId, reportId))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    transcriptionUsd: Number(row.transcriptionUsd),
    structuringUsd: Number(row.structuringUsd),
    totalUsd: Number(row.transcriptionUsd) + Number(row.structuringUsd),
  };
}

/** Rolling mean inference cost per report for an org, for the margin alert. */
export async function meanCostPerReport(
  db: Database,
  orgId: string,
  since: Date,
): Promise<{ meanUsd: number; reportCount: number }> {
  const [row] = await db
    .select({
      mean: sql<string | null>`avg(${reportCosts.transcriptionUsd} + ${reportCosts.structuringUsd})`,
      count: sql<number>`count(*)::int`,
    })
    .from(reportCosts)
    .where(sql`${reportCosts.orgId} = ${orgId} and ${reportCosts.updatedAt} >= ${since}`);

  return {
    meanUsd: row?.mean == null ? 0 : Number(row.mean),
    reportCount: row?.count ?? 0,
  };
}
