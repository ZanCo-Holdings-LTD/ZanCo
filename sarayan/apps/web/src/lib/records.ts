import {
  DEFAULT_LADDER,
  classify,
  daysBetween,
  planAlerts,
  today,
  type Channel,
  type LadderRung,
  type WatchTarget,
} from "@sarayan/core-watch";
import { and, eq, inArray, isNull, notInArray, sql as raw } from "drizzle-orm";
import { db } from "@/db";
import { alerts, organisations, records, type Organisation, type RecordStatus } from "@/db/schema";
import { planFor } from "./plans";

/**
 * Record lifecycle.
 *
 * Two operations, both idempotent and both pure-function-driven: recompute a
 * record's status, and reconcile its alert ladder. Everything that decides
 * *when* an alert fires lives in `@sarayan/core-watch`; this file only reads and
 * writes rows.
 */

export function toWatchTarget(record: {
  id: string;
  expiresOn: string | null;
  noExpiry: boolean;
  archivedAt: Date | null;
}): WatchTarget {
  return {
    id: record.id,
    expiresOn: record.noExpiry ? null : record.expiresOn,
    active: record.archivedAt === null,
  };
}

export function statusOf(record: {
  id: string;
  expiresOn: string | null;
  noExpiry: boolean;
  archivedAt: Date | null;
}): RecordStatus {
  return classify(toWatchTarget(record)) as RecordStatus;
}

export function daysRemaining(expiresOn: string | null): number | null {
  if (!expiresOn) return null;
  return daysBetween(today(), expiresOn);
}

/** The organisation's ladder, falling back to the default 90/60/30/14/7/1. */
export function ladderFor(organisation: Pick<Organisation, "alertLadder">): LadderRung[] {
  const custom = organisation.alertLadder;
  if (!Array.isArray(custom) || custom.length === 0) return DEFAULT_LADDER;

  const parsed: LadderRung[] = [];
  for (const entry of custom) {
    if (typeof entry !== "object" || entry === null) continue;
    const rung = entry as Partial<LadderRung>;
    if (typeof rung.offsetDays !== "number") continue;
    parsed.push({
      offsetDays: rung.offsetDays,
      channels: Array.isArray(rung.channels) && rung.channels.length > 0 ? rung.channels : ["email"],
      audience: Array.isArray(rung.audience) && rung.audience.length > 0 ? rung.audience : ["owner"],
      escalateIfUnacknowledged: Boolean(rung.escalateIfUnacknowledged),
    });
  }
  return parsed.length > 0 ? parsed : DEFAULT_LADDER;
}

/** Channels the organisation's tier permits. WhatsApp is metered, so it is gated. */
export function allowedChannels(organisation: Pick<Organisation, "tier">): Channel[] {
  return planFor(organisation.tier).channels;
}

/**
 * Reconcile a record's alerts with its current expiry date.
 *
 * Called after every create and every date change. Upserts on
 * `(recordId, offsetDays)`, so re-running it is free — and cancels rungs that
 * no longer apply, which is what makes an early renewal stop the nagging.
 */
export async function syncAlerts(recordId: string): Promise<number> {
  const rows = await db
    .select({ record: records, organisation: organisations })
    .from(records)
    .innerJoin(organisations, eq(organisations.id, records.organisationId))
    .where(eq(records.id, recordId))
    .limit(1);

  const row = rows[0];
  if (!row) return 0;

  const target = toWatchTarget(row.record);
  const planned = planAlerts(target, {
    ladder: ladderFor(row.organisation),
    allowedChannels: allowedChannels(row.organisation),
    catchUpFrom: today(),
  });

  if (planned.length === 0) {
    // No expiry, or archived: retire anything still scheduled.
    await db
      .update(alerts)
      .set({ status: "cancelled" })
      .where(and(eq(alerts.recordId, recordId), eq(alerts.status, "scheduled")));
    return 0;
  }

  await db
    .insert(alerts)
    .values(
      planned.map((alert) => ({
        organisationId: row.record.organisationId,
        recordId,
        offsetDays: alert.offsetDays,
        dueOn: alert.dueOn,
        channels: alert.channels,
        audience: alert.audience,
        escalateIfUnacknowledged: alert.escalateIfUnacknowledged,
        status: "scheduled" as const,
      })),
    )
    .onConflictDoUpdate({
      target: [alerts.recordId, alerts.offsetDays],
      set: {
        dueOn: raw`excluded.due_on`,
        channels: raw`excluded.channels`,
        audience: raw`excluded.audience`,
        escalateIfUnacknowledged: raw`excluded.escalate_if_unacknowledged`,
        // A rung that has already fired keeps its history; only future rungs
        // are reset to scheduled when the date moves.
        status: raw`case when ${alerts.sentAt} is null then 'scheduled'::alert_status else ${alerts.status} end`,
      },
    });

  // Rungs the new ladder no longer contains (tier downgrade, ladder edit).
  const keptOffsets = planned.map((alert) => alert.offsetDays);
  await db
    .update(alerts)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(alerts.recordId, recordId),
        eq(alerts.status, "scheduled"),
        notInArray(alerts.offsetDays, keptOffsets),
      ),
    );

  return planned.length;
}

/** Recompute `status` for one organisation. Cheap enough to run nightly. */
export async function refreshStatuses(organisationId?: string): Promise<number> {
  const asOf = today();

  const result = await db
    .update(records)
    .set({
      status: raw`
        case
          when ${records.noExpiry} or ${records.expiresOn} is null or ${records.archivedAt} is not null then 'dormant'::record_status
          when ${records.expiresOn} < ${asOf}::date then 'expired'::record_status
          when ${records.expiresOn} <= (${asOf}::date + interval '30 days') then 'critical'::record_status
          when ${records.expiresOn} <= (${asOf}::date + interval '90 days') then 'due_soon'::record_status
          else 'valid'::record_status
        end`,
      updatedAt: new Date(),
    })
    .where(organisationId ? eq(records.organisationId, organisationId) : isNull(records.archivedAt))
    .returning({ id: records.id });

  return result.length;
}

/** Cancel the remaining ladder for records whose renewal completed. */
export async function cancelFutureAlerts(recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;
  await db
    .update(alerts)
    .set({ status: "cancelled" })
    .where(and(inArray(alerts.recordId, recordIds), eq(alerts.status, "scheduled")));
}
