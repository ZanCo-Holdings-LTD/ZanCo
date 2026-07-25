/**
 * Renewal rules: data, versioned, dated.
 *
 * A rule says, for a jurisdiction and document type, how far ahead of expiry a
 * renewal opens and what the reminder ladder looks like. Rules are rows, not
 * code, because jurisdictions change requirements on their own schedule and
 * because every firm has its own working rhythm. See
 * `docs/adr/0001-renewal-rules-as-versioned-data.md`.
 *
 * Resolution has two independent axes and it is worth being precise about both:
 *
 *   Specificity — a rule a firm wrote for its own IFZA licences beats the
 *   system default for Dubai trade licences, which beats a catch-all for trade
 *   licences anywhere.
 *
 *   Time — a rule is only a candidate if the resolution date falls inside its
 *   `[effectiveFrom, effectiveTo)` window. This is what lets a renewal opened
 *   last year keep computing under last year's ladder.
 */
import { isOnOrAfter, isBefore, type PlainDate } from '../dates.js';
import type {
  Jurisdiction,
  NotificationAudience,
  NotificationChannel,
  RenewableDocType,
} from '../types.js';

/**
 * One rung of the escalation ladder.
 *
 * `daysBefore` counts back from the expiry date, so 90 is "three months out"
 * and a negative value is "after it has already expired" — which is a real and
 * necessary case, because a lapsed licence still needs chasing.
 */
export interface EscalationStep {
  readonly daysBefore: number;
  readonly channel: NotificationChannel;
  readonly templateKey: string;
  readonly audience: NotificationAudience;
  /**
   * Repeat the step every N days after the first send. This is how "a daily
   * alert in the final week" is expressed without listing seven rows.
   */
  readonly repeatEveryDays?: number;
  /** Inclusive floor for the repeat, in days-before terms. Defaults to 0 (expiry day). */
  readonly repeatUntilDaysBefore?: number;
}

export interface RenewalRule {
  readonly id: string;
  /** `null` means a system default that ships with the product. */
  readonly orgId: string | null;
  /** `null` means "any jurisdiction". */
  readonly jurisdiction: Jurisdiction | null;
  /** `null` means "any free zone", including entities with no free zone. */
  readonly freeZone: string | null;
  readonly docType: RenewableDocType;
  readonly leadTimeDays: number;
  readonly escalationSchedule: readonly EscalationStep[];
  readonly version: number;
  readonly effectiveFrom: PlainDate;
  /** Exclusive. `null` means still in force. */
  readonly effectiveTo: PlainDate | null;
  readonly notes: string | null;
  readonly isActive: boolean;
}

export interface RuleCriteria {
  readonly orgId: string;
  readonly docType: RenewableDocType;
  readonly jurisdiction: Jurisdiction | null;
  readonly freeZone: string | null;
  /**
   * The date the rule is resolved *as of*. For a new renewal this is the day it
   * opens; for an existing renewal it is the day it was created, which is what
   * makes historic renewals stable across rule changes.
   */
  readonly asOf: PlainDate;
}

const SPECIFICITY_ORG = 4;
const SPECIFICITY_FREE_ZONE = 2;
const SPECIFICITY_JURISDICTION = 1;

/** `null` if the rule cannot apply to these criteria at all. */
export function ruleSpecificity(rule: RenewalRule, criteria: RuleCriteria): number | null {
  if (rule.docType !== criteria.docType) return null;

  let score = 0;

  if (rule.orgId !== null) {
    if (rule.orgId !== criteria.orgId) return null;
    score += SPECIFICITY_ORG;
  }

  if (rule.freeZone !== null) {
    if (normaliseFreeZone(rule.freeZone) !== normaliseFreeZone(criteria.freeZone)) return null;
    score += SPECIFICITY_FREE_ZONE;
  }

  if (rule.jurisdiction !== null) {
    if (rule.jurisdiction !== criteria.jurisdiction) return null;
    score += SPECIFICITY_JURISDICTION;
  }

  return score;
}

function normaliseFreeZone(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function isRuleEffectiveOn(rule: RenewalRule, date: PlainDate): boolean {
  if (!rule.isActive) return false;
  if (!isOnOrAfter(date, rule.effectiveFrom)) return false;
  if (rule.effectiveTo !== null && !isBefore(date, rule.effectiveTo)) return false;
  return true;
}

/**
 * Pick the one rule that governs. Returns `null` when nothing matches, which
 * the caller must treat as "no renewal can be generated" rather than falling
 * back to a hardcoded lead time — a silent default is how a firm ends up
 * trusting a ladder nobody configured.
 */
export function selectRule(
  rules: readonly RenewalRule[],
  criteria: RuleCriteria,
): RenewalRule | null {
  let best: RenewalRule | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (!isRuleEffectiveOn(rule, criteria.asOf)) continue;

    const score = ruleSpecificity(rule, criteria);
    if (score === null) continue;

    if (best === null || score > bestScore || (score === bestScore && beats(rule, best))) {
      best = rule;
      bestScore = score;
    }
  }

  return best;
}

/** Tie-break at equal specificity: higher version, then later start, then stable by id. */
function beats(candidate: RenewalRule, incumbent: RenewalRule): boolean {
  if (candidate.version !== incumbent.version) return candidate.version > incumbent.version;
  if (candidate.effectiveFrom !== incumbent.effectiveFrom) {
    return candidate.effectiveFrom > incumbent.effectiveFrom;
  }
  return candidate.id > incumbent.id;
}

/**
 * Every rule version that has ever governed this document type, newest first.
 * Used by the settings screen so a firm can see what changed and when.
 */
export function ruleHistory(
  rules: readonly RenewalRule[],
  criteria: Omit<RuleCriteria, 'asOf'>,
): RenewalRule[] {
  return rules
    .filter((rule) => ruleSpecificity(rule, { ...criteria, asOf: rule.effectiveFrom }) !== null)
    .sort((a, b) =>
      a.effectiveFrom === b.effectiveFrom
        ? b.version - a.version
        : a.effectiveFrom < b.effectiveFrom
          ? 1
          : -1,
    );
}

export class RuleValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid renewal rule: ${issues.join('; ')}`);
    this.name = 'RuleValidationError';
    this.issues = issues;
  }
}

/**
 * Structural validation, run before a rule is written. This is the guard rail
 * on the settings screen — a firm tuning its own ladder should not be able to
 * save one that never fires.
 */
export function validateRule(
  rule: Pick<
    RenewalRule,
    'leadTimeDays' | 'escalationSchedule' | 'effectiveFrom' | 'effectiveTo' | 'version'
  >,
): readonly string[] {
  const issues: string[] = [];

  if (!Number.isInteger(rule.leadTimeDays) || rule.leadTimeDays < 0) {
    issues.push('leadTimeDays must be a non-negative integer');
  }
  if (rule.leadTimeDays > 730) {
    issues.push('leadTimeDays above 730 opens renewals more than two years ahead');
  }
  if (!Number.isInteger(rule.version) || rule.version < 1) {
    issues.push('version must be a positive integer');
  }
  if (rule.effectiveTo !== null && !isBefore(rule.effectiveFrom, rule.effectiveTo)) {
    issues.push('effectiveFrom must be strictly before effectiveTo');
  }
  if (rule.escalationSchedule.length === 0) {
    issues.push('escalationSchedule must contain at least one step');
  }

  rule.escalationSchedule.forEach((step, index) => {
    const where = `escalationSchedule[${index}]`;
    if (!Number.isInteger(step.daysBefore)) {
      issues.push(`${where}.daysBefore must be an integer`);
    }
    if (step.daysBefore > rule.leadTimeDays) {
      issues.push(
        `${where}.daysBefore (${step.daysBefore}) fires before the renewal opens ` +
          `(leadTimeDays ${rule.leadTimeDays}) and would never be sent`,
      );
    }
    if (step.templateKey.trim() === '') {
      issues.push(`${where}.templateKey must not be empty`);
    }
    if (step.repeatEveryDays !== undefined) {
      if (!Number.isInteger(step.repeatEveryDays) || step.repeatEveryDays < 1) {
        issues.push(`${where}.repeatEveryDays must be a positive integer`);
      }
      const until = step.repeatUntilDaysBefore ?? 0;
      if (!Number.isInteger(until)) {
        issues.push(`${where}.repeatUntilDaysBefore must be an integer`);
      } else if (until > step.daysBefore) {
        issues.push(
          `${where}.repeatUntilDaysBefore (${until}) must be at or below daysBefore ` +
            `(${step.daysBefore}) — the repeat counts down towards expiry`,
        );
      }
    }
  });

  return issues;
}

export function assertValidRule(
  rule: Parameters<typeof validateRule>[0],
): void {
  const issues = validateRule(rule);
  if (issues.length > 0) throw new RuleValidationError(issues);
}
