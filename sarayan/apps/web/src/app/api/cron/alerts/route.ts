import { decideDispatch, today, type Channel } from "@sarayan/core-watch";
import { and, count, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  alertDeliveries,
  alerts,
  entities,
  holders,
  memberships,
  organisations,
  records,
  users,
} from "@/db/schema";
import { documentTypeName } from "@/content/taxonomy";
import { env } from "@/lib/env";
import { deliver, type Recipient } from "@/lib/notify";
import { planFor } from "@/lib/plans";
import { daysRemaining, refreshStatuses } from "@/lib/records";
import { isLocale } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The alert scheduler.
 *
 * "This is fundamentally a scheduled-job business." Run it once a day (and
 * harmlessly more often): it recomputes every record's status, then walks the
 * alerts due today and dispatches or escalates each one according to
 * `decideDispatch`. Idempotent — a second run in the same day sends nothing new,
 * because sent alerts are already marked and re-escalation has a cooling-off
 * period.
 *
 * Deploy with Vercel Cron, a Kubernetes CronJob, or any scheduler that can make
 * an authenticated HTTP request. Inngest or Trigger.dev can call it too; the
 * logic does not care what wakes it.
 */
export async function POST(request: Request) {
  const authorised = authorise(request);
  if (!authorised) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const asOf = today();
  const started = Date.now();

  // Statuses first: an alert's message quotes the days remaining, and a stale
  // status would make the message wrong.
  const restatused = await refreshStatuses();

  const due = await db
    .select({
      alert: alerts,
      record: records,
      holder: holders,
      entity: entities,
      organisation: organisations,
      owner: users,
    })
    .from(alerts)
    .innerJoin(records, eq(records.id, alerts.recordId))
    .innerJoin(holders, eq(holders.id, records.holderId))
    .innerJoin(entities, eq(entities.id, records.entityId))
    .innerJoin(organisations, eq(organisations.id, alerts.organisationId))
    .leftJoin(users, eq(users.id, records.ownerUserId))
    .where(
      and(
        lte(alerts.dueOn, asOf),
        or(eq(alerts.status, "scheduled"), eq(alerts.status, "sent")),
        isNull(records.archivedAt),
      ),
    )
    // A hard cap so one enormous tenant cannot starve every other tenant's
    // alerts in a single run; the next run picks up what is left.
    .limit(2000);

  // Manager recipients, loaded once per organisation rather than per alert.
  const organisationIds = [...new Set(due.map((row) => row.organisation.id))];
  const managers = new Map<string, Recipient[]>();
  if (organisationIds.length > 0) {
    const managerRows = await db
      .select({
        organisationId: memberships.organisationId,
        role: memberships.role,
        user: users,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          inArray(memberships.organisationId, organisationIds),
          inArray(memberships.role, ["owner", "admin"]),
        ),
      );

    for (const row of managerRows) {
      const list = managers.get(row.organisationId) ?? [];
      list.push(toRecipient(row.user.name, row.user.email, row.user.phone, row.user.locale));
      managers.set(row.organisationId, list);
    }
  }

  let sent = 0;
  let escalated = 0;
  let skipped = 0;
  let failures = 0;

  for (const row of due) {
    const decision = decideDispatch(
      {
        targetId: row.record.id,
        offsetDays: row.alert.offsetDays,
        dueOn: row.alert.dueOn,
        channels: row.alert.channels as Channel[],
        audience: row.alert.audience as Array<"owner" | "managers" | "entity_contact">,
        escalateIfUnacknowledged: row.alert.escalateIfUnacknowledged,
        sentAt: row.alert.sentAt,
        acknowledgedAt: row.alert.acknowledgedAt,
        escalationCount: row.alert.escalationCount,
      },
      { asOf },
    );

    if (decision.action === "skip") {
      skipped += 1;
      continue;
    }

    const remaining = daysRemaining(row.record.expiresOn) ?? 0;
    const documentLabel = row.record.documentTypeCode
      ? documentTypeName(row.record.documentTypeCode, isLocale(row.organisation.locale) ? row.organisation.locale : "en")
      : row.record.customTypeName ?? "Document";

    const message = {
      recordTitle: documentLabel,
      documentTypeName: documentLabel,
      holderName: row.holder.name,
      entityName: row.entity.name,
      expiresOn: row.record.expiresOn ?? "",
      daysRemaining: remaining,
      recordUrl: `${env.appUrl}/${row.organisation.locale}/app/records/${row.record.id}`,
      acknowledgeUrl: `${env.appUrl}/${row.organisation.locale}/app/alerts?ack=${row.alert.id}`,
    };

    // Build the recipient set for this rung's audience.
    const recipients: Recipient[] = [];
    if (decision.audience.includes("owner") && row.owner) {
      recipients.push(toRecipient(row.owner.name, row.owner.email, row.owner.phone, row.owner.locale));
    }
    if (decision.audience.includes("managers")) {
      recipients.push(...(managers.get(row.organisation.id) ?? []));
    }
    if (decision.audience.includes("entity_contact") && row.entity.contactEmail) {
      recipients.push(
        toRecipient(
          row.entity.contactName ?? row.entity.name,
          row.entity.contactEmail,
          row.entity.contactPhone,
          row.organisation.locale,
        ),
      );
    }
    if (recipients.length === 0 && managers.has(row.organisation.id)) {
      // An unassigned record must not go silent.
      recipients.push(...(managers.get(row.organisation.id) ?? []));
    }

    const deduped = dedupe(recipients);
    const allowed = new Set(planFor(row.organisation.tier).channels);
    const channels = (row.alert.channels as Channel[]).filter((channel) => allowed.has(channel));

    // WhatsApp allowance: fall back to email once the month's quota is used,
    // rather than silently billing the account into a negative margin.
    const quotaExceeded = channels.includes("whatsapp")
      ? await whatsappQuotaExceeded(row.organisation.id, planFor(row.organisation.tier).includedWhatsappMessages)
      : false;
    const effectiveChannels = quotaExceeded
      ? channels.filter((channel) => channel !== "whatsapp")
      : channels;

    let anySucceeded = false;
    for (const recipient of deduped) {
      for (const channel of effectiveChannels.length > 0 ? effectiveChannels : (["in_app"] as Channel[])) {
        const outcome = await deliver(
          row.organisation.id,
          row.alert.id,
          channel,
          recipient,
          message,
        );
        if (outcome.succeeded) anySucceeded = true;
        else if (channel !== "in_app") failures += 1;
      }
    }

    await db
      .update(alerts)
      .set({
        status: "sent",
        sentAt: decision.action === "send" ? new Date() : row.alert.sentAt ?? new Date(),
        escalationCount:
          decision.action === "escalate" ? row.alert.escalationCount + 1 : row.alert.escalationCount,
        lastError: anySucceeded ? null : "No channel delivered successfully.",
      })
      .where(eq(alerts.id, row.alert.id));

    if (decision.action === "send") sent += 1;
    else escalated += 1;
  }

  return NextResponse.json({
    ok: true,
    asOf,
    restatused,
    considered: due.length,
    sent,
    escalated,
    skipped,
    failures,
    durationMs: Date.now() - started,
  });
}

/** Vercel Cron issues GET requests; both verbs run the same job. */
export async function GET(request: Request) {
  return POST(request);
}

function authorise(request: Request): boolean {
  if (!env.cronSecret) {
    // Without a configured secret the endpoint is refused in production and
    // open in development, rather than being accidentally public.
    return !env.isProduction;
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token === env.cronSecret || request.headers.get("x-cron-secret") === env.cronSecret;
}

function toRecipient(
  name: string,
  email: string | null,
  phone: string | null,
  locale: string,
): Recipient {
  return {
    name,
    email,
    phone,
    locale: locale === "ar" ? "ar" : "en",
  };
}

function dedupe(recipients: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = `${recipient.email ?? ""}|${recipient.phone ?? ""}|${recipient.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function whatsappQuotaExceeded(organisationId: string, allowance: number): Promise<boolean> {
  if (allowance <= 0) return true;
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ used: count() })
    .from(alertDeliveries)
    .where(
      and(
        eq(alertDeliveries.organisationId, organisationId),
        eq(alertDeliveries.channel, "whatsapp"),
        eq(alertDeliveries.succeeded, true),
        gte(alertDeliveries.sentAt, startOfMonth),
      ),
    );

  return (row?.used ?? 0) >= allowance;
}
