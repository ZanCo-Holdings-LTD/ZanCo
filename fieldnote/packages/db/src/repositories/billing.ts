import { eq, sql } from 'drizzle-orm';
import type { StructuringUsage } from '@fieldnote/shared';
import { structuringCostUsd, transcriptionCostUsd } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { reportCosts, subscriptions } from '../schema/billing.js';

/**
 * Money crosses the storage boundary as integer minor units, never as a float.
 * These two functions are the only place the conversion happens.
 */
const MICROS_PER_USD = 1_000_000;

function toMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

function fromMicros(micros: number): number {
  return micros / MICROS_PER_USD;
}

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
  const micros = toMicros(structuringCostUsd(usage));
  const cached = usage.cacheReadInputTokens + usage.cacheCreationInputTokens;

  await db
    .insert(reportCosts)
    .values({
      orgId,
      reportId,
      structuringMicrosUsd: micros,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: cached,
    })
    .onConflictDoUpdate({
      target: reportCosts.reportId,
      set: {
        structuringMicrosUsd: sql`${reportCosts.structuringMicrosUsd} + ${micros}`,
        inputTokens: sql`${reportCosts.inputTokens} + ${usage.inputTokens}`,
        outputTokens: sql`${reportCosts.outputTokens} + ${usage.outputTokens}`,
        cachedInputTokens: sql`${reportCosts.cachedInputTokens} + ${cached}`,
      },
    });
}

export async function addTranscriptionCost(
  db: Database,
  orgId: string,
  reportId: string,
  durationMs: number,
): Promise<void> {
  const micros = toMicros(transcriptionCostUsd(durationMs));
  await db
    .insert(reportCosts)
    .values({
      orgId,
      reportId,
      transcriptionMicrosUsd: micros,
      audioMs: durationMs,
    })
    .onConflictDoUpdate({
      target: reportCosts.reportId,
      set: {
        transcriptionMicrosUsd: sql`${reportCosts.transcriptionMicrosUsd} + ${micros}`,
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
    // Converted back to USD only at the boundary, for display and alerting.
    transcriptionUsd: fromMicros(row.transcriptionMicrosUsd),
    structuringUsd: fromMicros(row.structuringMicrosUsd),
    totalUsd: fromMicros(row.transcriptionMicrosUsd + row.structuringMicrosUsd),
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
      mean: sql<
        string | null
      >`avg(${reportCosts.transcriptionMicrosUsd} + ${reportCosts.structuringMicrosUsd})`,
      count: sql<number>`count(*)::int`,
    })
    .from(reportCosts)
    .where(sql`${reportCosts.orgId} = ${orgId} and ${reportCosts.updatedAt} >= ${since}`);

  return {
    meanUsd: row?.mean == null ? 0 : fromMicros(Number(row.mean)),
    reportCount: row?.count ?? 0,
  };
}
