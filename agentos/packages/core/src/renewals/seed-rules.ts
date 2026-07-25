/**
 * The default rule set a new organisation starts with.
 *
 * IMPORTANT — these are a *starting position*, not researched fact. The brief is
 * explicit that the real ladders come out of the M0 interviews, and until those
 * notes exist in `docs/m0-interviews.md` these lead times are informed guesses
 * about how far ahead a firm wants to start chasing. They are deliberately
 * conservative (start early, escalate hard) because the cost of an early
 * reminder is an ignored email and the cost of a late one is a fined client.
 *
 * They are seeded as `orgId: null` system rules with `version: 1`. A firm tunes
 * them by writing its own rows, which win on specificity without touching
 * these. When the M0 numbers land, add version 2 rows with a new
 * `effectiveFrom` — do not edit these in place, or you will retroactively
 * change ladders that are already running.
 *
 * AgentOS is a workflow tool for professionals who know the rules. Nothing here
 * is advice about what a jurisdiction requires, and the product must never
 * present it as such.
 */
import type { PlainDate } from '../dates.js';
import type { RenewableDocType } from '../types.js';
import type { EscalationStep, RenewalRule } from './rules.js';

export const SEED_EFFECTIVE_FROM: PlainDate = '2024-01-01';

/**
 * The standard ladder for a company-level document with a long lead time.
 *
 * Email first and early, then email plus WhatsApp as it tightens, then a daily
 * WhatsApp run in the final week that escalates from the assigned PRO to the
 * account manager. In the Gulf an email reminder that is not also a WhatsApp
 * message effectively did not happen, so every rung past the first opening
 * notice pairs the two.
 */
function entityLadder(leadTimeDays: number): EscalationStep[] {
  const steps: EscalationStep[] = [];

  // A rung that fires before the renewal opens would never be sent, so the
  // early rungs only appear when the lead time is long enough to reach them.
  if (leadTimeDays >= 90) {
    steps.push({
      daysBefore: 90,
      channel: 'email',
      audience: 'assigned_pro',
      templateKey: 'renewal.opening_notice',
    });
  }
  if (leadTimeDays >= 60) {
    steps.push({
      daysBefore: 60,
      channel: 'email',
      audience: 'client_contact',
      templateKey: 'renewal.client_first_notice',
    });
  }

  steps.push({
    daysBefore: 30,
    channel: 'email',
    audience: 'client_contact',
    templateKey: 'renewal.client_reminder',
  });
  steps.push({
    daysBefore: 30,
    channel: 'whatsapp',
    audience: 'client_contact',
    templateKey: 'renewal_reminder_30d',
  });
  steps.push({
    daysBefore: 14,
    channel: 'email',
    audience: 'assigned_pro',
    templateKey: 'renewal.pro_action_required',
  });
  steps.push({
    daysBefore: 14,
    channel: 'whatsapp',
    audience: 'client_contact',
    templateKey: 'renewal_reminder_14d',
  });

  // The final week: daily, both channels, and the account manager is copied so
  // it stops being one person's problem.
  steps.push({
    daysBefore: 7,
    channel: 'whatsapp',
    audience: 'client_contact',
    templateKey: 'renewal_urgent_daily',
    repeatEveryDays: 1,
    repeatUntilDaysBefore: 1,
  });
  steps.push({
    daysBefore: 7,
    channel: 'email',
    audience: 'account_manager',
    templateKey: 'renewal.escalation_final_week',
  });
  steps.push({
    daysBefore: 0,
    channel: 'email',
    audience: 'account_manager',
    templateKey: 'renewal.expires_today',
  });

  // Past expiry. A lapsed document is a fine accruing, so this does not stop.
  steps.push({
    daysBefore: -1,
    channel: 'email',
    audience: 'org_owner',
    templateKey: 'renewal.overdue',
    repeatEveryDays: 3,
    repeatUntilDaysBefore: -30,
  });

  return steps;
}

/** People documents move faster and the person themselves is in the loop. */
function personLadder(leadTimeDays: number): EscalationStep[] {
  const steps: EscalationStep[] = [];

  if (leadTimeDays >= 90) {
    steps.push({
      daysBefore: 90,
      channel: 'email',
      audience: 'assigned_pro',
      templateKey: 'renewal.opening_notice',
    });
  }

  if (leadTimeDays >= 45) {
    steps.push({
      daysBefore: 45,
      channel: 'email',
      audience: 'client_contact',
      templateKey: 'renewal.client_first_notice',
    });
  }
  steps.push({
    daysBefore: 30,
    channel: 'whatsapp',
    audience: 'client_contact',
    templateKey: 'renewal_reminder_30d',
  });
  steps.push({
    daysBefore: 14,
    channel: 'email',
    audience: 'assigned_pro',
    templateKey: 'renewal.pro_action_required',
  });
  steps.push({
    daysBefore: 7,
    channel: 'whatsapp',
    audience: 'client_contact',
    templateKey: 'renewal_urgent_daily',
    repeatEveryDays: 1,
    repeatUntilDaysBefore: 1,
  });
  steps.push({
    daysBefore: 0,
    channel: 'email',
    audience: 'account_manager',
    templateKey: 'renewal.expires_today',
  });
  steps.push({
    daysBefore: -1,
    channel: 'email',
    audience: 'account_manager',
    templateKey: 'renewal.overdue',
    repeatEveryDays: 2,
    repeatUntilDaysBefore: -14,
  });

  return steps;
}

interface SeedSpec {
  readonly docType: RenewableDocType;
  readonly leadTimeDays: number;
  readonly kind: 'entity' | 'person';
  readonly notes: string;
}

const SEED_SPECS: readonly SeedSpec[] = [
  {
    docType: 'trade_licence',
    leadTimeDays: 90,
    kind: 'entity',
    notes:
      'Draft default. Free zones differ widely on how early they open renewal; ' +
      'expect to split this into per-free-zone rules after M0.',
  },
  {
    docType: 'commercial_registration',
    leadTimeDays: 90,
    kind: 'entity',
    notes: 'Draft default for Saudi CR. Confirm against firm practice in M0.',
  },
  {
    docType: 'establishment_card',
    leadTimeDays: 60,
    kind: 'entity',
    notes:
      'Draft default. Usually gated on the trade licence being renewed first, ' +
      'which is why the ladder opens later than the licence.',
  },
  {
    docType: 'immigration_card',
    leadTimeDays: 60,
    kind: 'entity',
    notes: 'Draft default.',
  },
  {
    docType: 'chamber_of_commerce',
    leadTimeDays: 45,
    kind: 'entity',
    notes: 'Draft default.',
  },
  {
    docType: 'municipality_permit',
    leadTimeDays: 45,
    kind: 'entity',
    notes: 'Draft default.',
  },
  {
    docType: 'ejari_lease',
    leadTimeDays: 90,
    kind: 'entity',
    notes:
      'Draft default. Lease renewal usually has to land before the licence ' +
      'renewal can be filed, so it opens as early as the licence.',
  },
  {
    docType: 'office_lease',
    leadTimeDays: 90,
    kind: 'entity',
    notes: 'Draft default.',
  },
  {
    docType: 'visa_quota',
    leadTimeDays: 60,
    kind: 'entity',
    notes:
      'Quota is not strictly an expiry, but firms track its review date the ' +
      'same way and want it on the same dashboard.',
  },
  {
    docType: 'passport',
    leadTimeDays: 180,
    kind: 'person',
    notes:
      'Draft default. Long lead because most visa processes want six months of ' +
      'passport validity remaining, so the passport has to move well before it expires.',
  },
  {
    docType: 'residence_visa',
    leadTimeDays: 90,
    kind: 'person',
    notes: 'Draft default.',
  },
  { docType: 'iqama', leadTimeDays: 90, kind: 'person', notes: 'Draft default.' },
  { docType: 'emirates_id', leadTimeDays: 60, kind: 'person', notes: 'Draft default.' },
  { docType: 'labour_card', leadTimeDays: 60, kind: 'person', notes: 'Draft default.' },
  {
    docType: 'medical_insurance',
    leadTimeDays: 45,
    kind: 'person',
    notes: 'Draft default. Mandatory in several jurisdictions and easy to forget.',
  },
  { docType: 'work_permit', leadTimeDays: 60, kind: 'person', notes: 'Draft default.' },
];

/**
 * System rules, jurisdiction-agnostic (`jurisdiction: null`) so that a firm in
 * any emirate or in Saudi gets a working ladder on day one. Jurisdiction- and
 * free-zone-specific rows are layered on top as they are learned.
 */
export function seedRenewalRules(): RenewalRule[] {
  return SEED_SPECS.map((spec) => ({
    id: `system:${spec.docType}:v1`,
    orgId: null,
    jurisdiction: null,
    freeZone: null,
    docType: spec.docType,
    leadTimeDays: spec.leadTimeDays,
    escalationSchedule:
      spec.kind === 'entity' ? entityLadder(spec.leadTimeDays) : personLadder(spec.leadTimeDays),
    version: 1,
    effectiveFrom: SEED_EFFECTIVE_FROM,
    effectiveTo: null,
    notes: spec.notes,
    isActive: true,
  }));
}
