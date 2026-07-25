/**
 * @sarayan/core-watch
 *
 * Observe a value, detect a state change, escalate through a channel ladder
 * with acknowledgement.
 *
 * Nothing in here talks to a database, a mail server or a model. It is pure
 * functions over plain data, because the compliance logic is the part that must
 * never be wrong — and pure functions are the part you can actually test.
 */

export * from "./dates";

import {
  addDays,
  daysBetween,
  today as todayOf,
  type PlainDate,
} from "./dates";

// ---------------------------------------------------------------------------
// Watch state
// ---------------------------------------------------------------------------

/**
 * The lifecycle of a watched value. Ordered by severity so `Math.max` over
 * severities is meaningful.
 */
export const WATCH_STATES = ["valid", "due_soon", "critical", "expired", "dormant"] as const;
export type WatchState = (typeof WATCH_STATES)[number];

export const WATCH_STATE_SEVERITY: Record<WatchState, number> = {
  dormant: 0,
  valid: 1,
  due_soon: 2,
  critical: 3,
  expired: 4,
};

export interface WatchThresholds {
  /** Days before expiry at which the value becomes `due_soon`. */
  dueSoonDays: number;
  /** Days before expiry at which the value becomes `critical`. */
  criticalDays: number;
}

export const DEFAULT_THRESHOLDS: WatchThresholds = { dueSoonDays: 90, criticalDays: 30 };

export interface WatchTarget {
  id: string;
  /** `null` means the document does not expire (e.g. a birth certificate). */
  expiresOn: PlainDate | null;
  /** Watching is suspended for archived records without deleting their history. */
  active?: boolean;
}

export function classify(
  target: WatchTarget,
  asOf: PlainDate = todayOf(),
  thresholds: WatchThresholds = DEFAULT_THRESHOLDS,
): WatchState {
  if (target.active === false || target.expiresOn === null) return "dormant";
  const remaining = daysBetween(asOf, target.expiresOn);
  if (remaining < 0) return "expired";
  if (remaining <= thresholds.criticalDays) return "critical";
  if (remaining <= thresholds.dueSoonDays) return "due_soon";
  return "valid";
}

export interface StateChange {
  targetId: string;
  from: WatchState;
  to: WatchState;
  /** True when the value moved towards expiry rather than away from it. */
  escalated: boolean;
}

/** Detect a transition. Returns `null` when nothing changed. */
export function detectChange(
  target: WatchTarget,
  previous: WatchState,
  asOf: PlainDate = todayOf(),
  thresholds: WatchThresholds = DEFAULT_THRESHOLDS,
): StateChange | null {
  const next = classify(target, asOf, thresholds);
  if (next === previous) return null;
  return {
    targetId: target.id,
    from: previous,
    to: next,
    escalated: WATCH_STATE_SEVERITY[next] > WATCH_STATE_SEVERITY[previous],
  };
}

// ---------------------------------------------------------------------------
// The escalation ladder
// ---------------------------------------------------------------------------

export const CHANNELS = ["in_app", "email", "whatsapp", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface LadderRung {
  /** Days before expiry this rung fires. Negative fires after expiry. */
  offsetDays: number;
  /** Channels to notify, in order. */
  channels: Channel[];
  /**
   * Who to notify. `owner` is the record's assigned owner; `managers` are org
   * admins and owners; `entity_contact` is the entity's nominated contact.
   */
  audience: Array<"owner" | "managers" | "entity_contact">;
  /**
   * When true, an unacknowledged rung is re-sent to the next audience up. This
   * is what stops an alert dying in a departing PRO's inbox.
   */
  escalateIfUnacknowledged?: boolean;
}

/**
 * The default ladder from the brief: 90 / 60 / 30 / 14 / 7 / 1 days, then a
 * daily overdue nag. Alerts get louder and wider as the date approaches.
 */
export const DEFAULT_LADDER: LadderRung[] = [
  { offsetDays: 90, channels: ["in_app", "email"], audience: ["owner"] },
  { offsetDays: 60, channels: ["in_app", "email"], audience: ["owner"] },
  { offsetDays: 30, channels: ["in_app", "email"], audience: ["owner", "managers"] },
  {
    offsetDays: 14,
    channels: ["in_app", "email", "whatsapp"],
    audience: ["owner", "managers"],
    escalateIfUnacknowledged: true,
  },
  {
    offsetDays: 7,
    channels: ["in_app", "email", "whatsapp"],
    audience: ["owner", "managers", "entity_contact"],
    escalateIfUnacknowledged: true,
  },
  {
    offsetDays: 1,
    channels: ["in_app", "email", "whatsapp"],
    audience: ["owner", "managers", "entity_contact"],
    escalateIfUnacknowledged: true,
  },
  {
    offsetDays: -1,
    channels: ["in_app", "email", "whatsapp"],
    audience: ["owner", "managers", "entity_contact"],
    escalateIfUnacknowledged: true,
  },
  {
    offsetDays: -7,
    channels: ["in_app", "email", "whatsapp"],
    audience: ["owner", "managers", "entity_contact"],
    escalateIfUnacknowledged: true,
  },
];

export interface PlannedAlert {
  targetId: string;
  offsetDays: number;
  /** The calendar day this alert should be dispatched. */
  dueOn: PlainDate;
  channels: Channel[];
  audience: LadderRung["audience"];
  escalateIfUnacknowledged: boolean;
}

export interface PlanOptions {
  ladder?: LadderRung[];
  /**
   * Channels the organisation's tier actually permits. WhatsApp is metered, so
   * a Starter account's ladder silently degrades to email rather than failing.
   */
  allowedChannels?: Channel[];
  /**
   * Rungs whose due date has already passed are normally dropped — a record
   * added 10 days before expiry should not fire a "90 days remaining" alert.
   * Set this to keep the most recent lapsed rung so a late-added record still
   * announces itself once.
   */
  catchUpFrom?: PlainDate;
}

/**
 * Turn an expiry date into the full set of alerts that should exist for it.
 *
 * Deterministic and idempotent: re-planning the same record on a later day
 * produces the same rows, so the scheduler can upsert on `(targetId, offsetDays)`.
 */
export function planAlerts(target: WatchTarget, options: PlanOptions = {}): PlannedAlert[] {
  if (target.expiresOn === null || target.active === false) return [];

  const ladder = options.ladder ?? DEFAULT_LADDER;
  const allowed = options.allowedChannels;
  const planned: PlannedAlert[] = [];

  for (const rung of ladder) {
    const channels = allowed
      ? degradeChannels(rung.channels, allowed)
      : [...rung.channels];
    if (channels.length === 0) continue;
    planned.push({
      targetId: target.id,
      offsetDays: rung.offsetDays,
      dueOn: addDays(target.expiresOn, -rung.offsetDays),
      channels,
      audience: [...rung.audience],
      escalateIfUnacknowledged: rung.escalateIfUnacknowledged ?? false,
    });
  }

  planned.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  if (options.catchUpFrom) {
    const from = options.catchUpFrom;
    const future = planned.filter((alert) => alert.dueOn >= from);
    const lapsed = planned.filter((alert) => alert.dueOn < from);
    // Keep only the last lapsed rung, dated today, so the register announces a
    // late-added record once instead of firing six historical alerts at it.
    if (lapsed.length > 0) {
      const mostRecent = lapsed[lapsed.length - 1];
      return [{ ...mostRecent, dueOn: from }, ...future];
    }
    return future;
  }

  return planned;
}

/**
 * Drop channels the tier does not include, and make sure something still gets
 * sent. Silence is the one unacceptable outcome.
 */
export function degradeChannels(requested: Channel[], allowed: Channel[]): Channel[] {
  const kept = requested.filter((channel) => allowed.includes(channel));
  if (kept.length > 0) return kept;
  if (allowed.includes("email")) return ["email"];
  if (allowed.includes("in_app")) return ["in_app"];
  return [];
}

// ---------------------------------------------------------------------------
// Dispatch decisions
// ---------------------------------------------------------------------------

export interface AlertRecord {
  targetId: string;
  offsetDays: number;
  dueOn: PlainDate;
  channels: Channel[];
  audience: LadderRung["audience"];
  escalateIfUnacknowledged: boolean;
  sentAt: Date | null;
  acknowledgedAt: Date | null;
  /** How many times this rung has been re-sent after going unacknowledged. */
  escalationCount?: number;
}

export interface DispatchDecision {
  alert: AlertRecord;
  action: "send" | "escalate" | "skip";
  /** Widened audience when escalating an unacknowledged alert. */
  audience: LadderRung["audience"];
  reason: string;
}

export interface DispatchOptions {
  asOf?: PlainDate;
  /** Days an alert may sit unacknowledged before it escalates. */
  reEscalateAfterDays?: number;
  /** Cap on re-sends so a stubbornly ignored alert cannot bill forever. */
  maxEscalations?: number;
}

/**
 * Decide what to do with a stored alert today. The scheduler calls this for
 * every due row; everything about *why* an alert fires lives here.
 */
export function decideDispatch(
  alert: AlertRecord,
  options: DispatchOptions = {},
): DispatchDecision {
  const asOf = options.asOf ?? todayOf();
  const reEscalateAfterDays = options.reEscalateAfterDays ?? 3;
  const maxEscalations = options.maxEscalations ?? 3;

  if (alert.acknowledgedAt) {
    return { alert, action: "skip", audience: alert.audience, reason: "acknowledged" };
  }
  if (alert.dueOn > asOf) {
    return { alert, action: "skip", audience: alert.audience, reason: "not_yet_due" };
  }
  if (!alert.sentAt) {
    return { alert, action: "send", audience: alert.audience, reason: "due" };
  }
  if (!alert.escalateIfUnacknowledged) {
    return { alert, action: "skip", audience: alert.audience, reason: "already_sent" };
  }

  const escalations = alert.escalationCount ?? 0;
  if (escalations >= maxEscalations) {
    return { alert, action: "skip", audience: alert.audience, reason: "escalation_cap_reached" };
  }

  const daysSinceSent = daysBetween(alert.sentAt.toISOString().slice(0, 10), asOf);
  if (daysSinceSent < reEscalateAfterDays) {
    return { alert, action: "skip", audience: alert.audience, reason: "cooling_off" };
  }

  return {
    alert,
    action: "escalate",
    audience: widenAudience(alert.audience),
    reason: "unacknowledged",
  };
}

export function widenAudience(audience: LadderRung["audience"]): LadderRung["audience"] {
  const widened = new Set(audience);
  widened.add("managers");
  if (audience.includes("managers")) widened.add("entity_contact");
  return [...widened];
}

// ---------------------------------------------------------------------------
// Health signals
// ---------------------------------------------------------------------------

/**
 * Monthly alert acknowledgements per account is the retention leading indicator
 * in the brief, so it is computed here rather than in a dashboard query.
 */
export function acknowledgementRate(alerts: Pick<AlertRecord, "sentAt" | "acknowledgedAt">[]): number {
  const sent = alerts.filter((alert) => alert.sentAt);
  if (sent.length === 0) return 0;
  return sent.filter((alert) => alert.acknowledgedAt).length / sent.length;
}

/** Records under active monitoring — the north star metric. */
export function underActiveMonitoring(targets: WatchTarget[]): number {
  return targets.filter((t) => t.active !== false && t.expiresOn !== null).length;
}
