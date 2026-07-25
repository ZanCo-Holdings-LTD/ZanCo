/**
 * The renewal engine.
 *
 * Given a renewable record (a licence, an establishment card, a person's iqama)
 * and the rule that governs it, this computes when the renewal opens, when it
 * is due, and the exact dated ladder of reminders that follows. It is a pure
 * function of its inputs — no clock, no database, no I/O — so the whole thing
 * is testable against a table of cases, which is what you want for the one
 * component whose failure mode is a client getting fined.
 */
import {
  addDays,
  compareDates,
  daysUntil,
  isOnOrAfter,
  isOnOrBefore,
  type PlainDate,
} from '../dates.js';
import type {
  DocStatus,
  NotificationAudience,
  NotificationChannel,
  RenewableDocType,
} from '../types.js';
import type { EscalationStep, RenewalRule } from './rules.js';

/** A thing with an expiry date that the engine can open a renewal for. */
export interface RenewableSource {
  readonly id: string;
  readonly entityId: string;
  /** Which table it came from, so the renewal can point back at it. */
  readonly sourceType: RenewableSourceType;
  readonly docType: RenewableDocType;
  readonly expiresOn: PlainDate;
  /** Cancelled or superseded records do not generate renewals. */
  readonly status: DocStatus;
  readonly personId?: string | null;
}

export const RENEWABLE_SOURCE_TYPES = [
  'licence',
  'establishment_record',
  'visa_quota',
  'person_document',
] as const;
export type RenewableSourceType = (typeof RENEWABLE_SOURCE_TYPES)[number];

/**
 * A reminder the ladder says to send on a given day. `sequence` is stable for a
 * given (rule version, expiry date) pair, which is what lets the send log
 * dedupe without relying on wall-clock timing.
 */
export interface ScheduledReminder {
  readonly sequence: number;
  readonly scheduledOn: PlainDate;
  readonly daysBefore: number;
  readonly channel: NotificationChannel;
  readonly audience: NotificationAudience;
  readonly templateKey: string;
  /** Stable key for idempotent sending: one row per rung per renewal. */
  readonly dedupeKey: string;
}

/**
 * The frozen copy of a rule that a renewal carries. Once a renewal exists it
 * computes against this, not against the live rules table, so a rule change
 * next month cannot silently move a ladder that is already running.
 */
export interface RuleSnapshot {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly leadTimeDays: number;
  readonly escalationSchedule: readonly EscalationStep[];
  readonly resolvedOn: PlainDate;
}

export interface RenewalPlan {
  readonly sourceId: string;
  readonly sourceType: RenewableSourceType;
  readonly entityId: string;
  readonly docType: RenewableDocType;
  /** The day the renewal becomes visible and actionable. */
  readonly opensOn: PlainDate;
  /** The day the underlying document expires. */
  readonly dueOn: PlainDate;
  readonly snapshot: RuleSnapshot;
  readonly reminders: readonly ScheduledReminder[];
}

const MAX_REMINDER_OCCURRENCES = 400;

export function snapshotRule(rule: RenewalRule, resolvedOn: PlainDate): RuleSnapshot {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    leadTimeDays: rule.leadTimeDays,
    escalationSchedule: rule.escalationSchedule.map((step) => ({ ...step })),
    resolvedOn,
  };
}

/**
 * Expand the ladder into dated reminders for a specific expiry date.
 *
 * Repeats are expanded here rather than at send time so that the whole schedule
 * is inspectable — the firm can look at a renewal and see every message that
 * will go out, which is half of why they trust the system.
 */
export function expandEscalation(
  schedule: readonly EscalationStep[],
  dueOn: PlainDate,
): ScheduledReminder[] {
  const occurrences: Omit<ScheduledReminder, 'sequence' | 'dedupeKey'>[] = [];

  for (const step of schedule) {
    const until = step.repeatUntilDaysBefore ?? 0;
    const stride = step.repeatEveryDays;

    if (stride === undefined) {
      occurrences.push(toOccurrence(step, step.daysBefore, dueOn));
      continue;
    }

    let daysBefore = step.daysBefore;
    let guard = 0;
    while (daysBefore >= until && guard < MAX_REMINDER_OCCURRENCES) {
      occurrences.push(toOccurrence(step, daysBefore, dueOn));
      daysBefore -= stride;
      guard += 1;
    }
  }

  // Two rungs can land on the same day — a "30 days out" email and the first
  // day of a daily WhatsApp run, say. Same channel, audience, day and template
  // means one message, not two.
  const seen = new Set<string>();
  const deduped = occurrences.filter((occurrence) => {
    const key = occurrenceKey(occurrence);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => {
    const byDate = compareDates(a.scheduledOn, b.scheduledOn);
    if (byDate !== 0) return byDate;
    if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1;
    if (a.audience !== b.audience) return a.audience < b.audience ? -1 : 1;
    return a.templateKey < b.templateKey ? -1 : a.templateKey > b.templateKey ? 1 : 0;
  });

  return deduped.map((occurrence, index) => ({
    ...occurrence,
    sequence: index + 1,
    dedupeKey: occurrenceKey(occurrence),
  }));
}

function toOccurrence(
  step: EscalationStep,
  daysBefore: number,
  dueOn: PlainDate,
): Omit<ScheduledReminder, 'sequence' | 'dedupeKey'> {
  return {
    scheduledOn: addDays(dueOn, -daysBefore),
    daysBefore,
    channel: step.channel,
    audience: step.audience,
    templateKey: step.templateKey,
  };
}

function occurrenceKey(occurrence: Omit<ScheduledReminder, 'sequence' | 'dedupeKey'>): string {
  return [
    occurrence.scheduledOn,
    occurrence.channel,
    occurrence.audience,
    occurrence.templateKey,
  ].join('|');
}

export function renewalOpensOn(dueOn: PlainDate, leadTimeDays: number): PlainDate {
  return addDays(dueOn, -leadTimeDays);
}

/** Build the full plan for one renewable record under one rule. */
export function planRenewal(
  source: RenewableSource,
  rule: RenewalRule,
  resolvedOn: PlainDate,
): RenewalPlan {
  const snapshot = snapshotRule(rule, resolvedOn);
  return {
    sourceId: source.id,
    sourceType: source.sourceType,
    entityId: source.entityId,
    docType: source.docType,
    opensOn: renewalOpensOn(source.expiresOn, snapshot.leadTimeDays),
    dueOn: source.expiresOn,
    snapshot,
    reminders: expandEscalation(snapshot.escalationSchedule, source.expiresOn),
  };
}

/** Rebuild the ladder for a renewal that already exists, from its own snapshot. */
export function remindersFromSnapshot(
  snapshot: RuleSnapshot,
  dueOn: PlainDate,
): ScheduledReminder[] {
  return expandEscalation(snapshot.escalationSchedule, dueOn);
}

export type SkipReason =
  | 'source_not_active'
  | 'no_rule_matched'
  | 'not_yet_open'
  | 'already_tracked';

export interface GenerationDecision {
  readonly source: RenewableSource;
  readonly shouldOpen: boolean;
  readonly plan: RenewalPlan | null;
  readonly skipReason: SkipReason | null;
}

export interface GenerationContext {
  /** The day the generation run is happening. */
  readonly asOf: PlainDate;
  /**
   * `${sourceType}:${sourceId}:${dueOn}` for every renewal already in the
   * database, open or completed. A renewal is identified by what it renews and
   * when it is due, so re-running generation is idempotent and a completed
   * renewal is never resurrected.
   */
  readonly existingKeys: ReadonlySet<string>;
}

export function renewalKey(
  sourceType: RenewableSourceType,
  sourceId: string,
  dueOn: PlainDate,
): string {
  return `${sourceType}:${sourceId}:${dueOn}`;
}

/**
 * Decide whether a single renewable record should have a renewal opened for it
 * today. Separated from the batch entry point so the reason for every skip is
 * inspectable — "why is there no renewal for this licence" is a question the
 * support inbox will ask.
 */
export function decideGeneration(
  source: RenewableSource,
  rule: RenewalRule | null,
  context: GenerationContext,
): GenerationDecision {
  if (source.status === 'cancelled' || source.status === 'superseded') {
    return { source, shouldOpen: false, plan: null, skipReason: 'source_not_active' };
  }

  if (rule === null) {
    return { source, shouldOpen: false, plan: null, skipReason: 'no_rule_matched' };
  }

  const plan = planRenewal(source, rule, context.asOf);

  if (context.existingKeys.has(renewalKey(source.sourceType, source.id, plan.dueOn))) {
    return { source, shouldOpen: false, plan, skipReason: 'already_tracked' };
  }

  // An already-expired document still needs a renewal opened — that is the
  // backlog a firm discovers on the day they import their spreadsheet.
  if (!isOnOrAfter(context.asOf, plan.opensOn)) {
    return { source, shouldOpen: false, plan, skipReason: 'not_yet_open' };
  }

  return { source, shouldOpen: true, plan, skipReason: null };
}

/** Urgency buckets for the renewals dashboard, in the order they are shown. */
export const URGENCY_BUCKETS = ['overdue', 'critical', 'urgent', 'upcoming', 'later'] as const;
export type UrgencyBucket = (typeof URGENCY_BUCKETS)[number];

export const URGENCY_THRESHOLD_DAYS = {
  critical: 7,
  urgent: 30,
  upcoming: 90,
} as const;

export function urgencyBucket(dueOn: PlainDate, today: PlainDate): UrgencyBucket {
  const days = daysUntil(dueOn, today);
  if (days < 0) return 'overdue';
  if (days <= URGENCY_THRESHOLD_DAYS.critical) return 'critical';
  if (days <= URGENCY_THRESHOLD_DAYS.urgent) return 'urgent';
  if (days <= URGENCY_THRESHOLD_DAYS.upcoming) return 'upcoming';
  return 'later';
}

/**
 * Derived status of the underlying document. Never stored — see the note on
 * `DOC_STATUSES`. `leadTimeDays` comes from the governing rule, so a document
 * counts as "expiring" exactly when its renewal window has opened.
 */
export function deriveDocStatus(
  stored: DocStatus,
  expiresOn: PlainDate | null,
  today: PlainDate,
  leadTimeDays: number,
): DocStatus {
  if (stored === 'cancelled' || stored === 'superseded') return stored;
  if (expiresOn === null) return 'active';
  if (compareDates(expiresOn, today) < 0) return 'expired';
  if (isOnOrAfter(today, renewalOpensOn(expiresOn, leadTimeDays))) return 'expiring';
  return 'active';
}

/**
 * Which rungs of the ladder are due to fire on or before `asOf` and have not
 * already been sent.
 *
 * Missed days are caught up rather than skipped: if the worker was down on the
 * day a 30-day notice was scheduled, it goes out late instead of not at all.
 * That is the right trade for this product — a late reminder is recoverable, a
 * silently dropped one is the thing that loses the customer.
 */
export function dueReminders(
  reminders: readonly ScheduledReminder[],
  asOf: PlainDate,
  alreadySent: ReadonlySet<string>,
): ScheduledReminder[] {
  return reminders.filter(
    (reminder) =>
      isOnOrBefore(reminder.scheduledOn, asOf) && !alreadySent.has(reminder.dedupeKey),
  );
}

/** The next rung that has not yet fired, for the "next reminder" column. */
export function nextReminder(
  reminders: readonly ScheduledReminder[],
  asOf: PlainDate,
  alreadySent: ReadonlySet<string>,
): ScheduledReminder | null {
  return (
    reminders.find(
      (reminder) => !alreadySent.has(reminder.dedupeKey) && isOnOrAfter(reminder.scheduledOn, asOf),
    ) ?? null
  );
}

/** Human-readable summary of a ladder, for the settings screen. */
export function describeLadder(schedule: readonly EscalationStep[]): string[] {
  return schedule.map((step) => {
    const when =
      step.daysBefore > 0
        ? `${step.daysBefore} days before expiry`
        : step.daysBefore === 0
          ? 'on the expiry date'
          : `${Math.abs(step.daysBefore)} days after expiry`;
    const repeat =
      step.repeatEveryDays === undefined
        ? ''
        : `, repeating every ${step.repeatEveryDays} day(s) until ` +
          `${step.repeatUntilDaysBefore ?? 0} days before expiry`;
    return `${when}: ${step.channel} to ${step.audience} using "${step.templateKey}"${repeat}`;
  });
}
