import { describe, expect, it } from 'vitest';
import {
  decideGeneration,
  deriveDocStatus,
  dueReminders,
  expandEscalation,
  nextReminder,
  planRenewal,
  renewalKey,
  renewalOpensOn,
  urgencyBucket,
  type RenewableSource,
} from './engine.js';
import { selectRule, validateRule, type EscalationStep, type RenewalRule } from './rules.js';
import { seedRenewalRules } from './seed-rules.js';

function rule(overrides: Partial<RenewalRule> = {}): RenewalRule {
  return {
    id: 'rule-1',
    orgId: null,
    jurisdiction: null,
    freeZone: null,
    docType: 'trade_licence',
    leadTimeDays: 90,
    escalationSchedule: [
      { daysBefore: 90, channel: 'email', audience: 'assigned_pro', templateKey: 'open' },
      { daysBefore: 30, channel: 'email', audience: 'client_contact', templateKey: 'remind' },
      { daysBefore: 30, channel: 'whatsapp', audience: 'client_contact', templateKey: 'wa_remind' },
    ],
    version: 1,
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    notes: null,
    isActive: true,
    ...overrides,
  };
}

function source(overrides: Partial<RenewableSource> = {}): RenewableSource {
  return {
    id: 'lic-1',
    entityId: 'ent-1',
    sourceType: 'licence',
    docType: 'trade_licence',
    expiresOn: '2026-03-14',
    status: 'active',
    ...overrides,
  };
}

describe('renewalOpensOn', () => {
  it('counts the lead time back from expiry', () => {
    expect(renewalOpensOn('2026-03-14', 90)).toBe('2025-12-14');
    expect(renewalOpensOn('2026-01-01', 1)).toBe('2025-12-31');
    expect(renewalOpensOn('2026-03-14', 0)).toBe('2026-03-14');
  });
});

describe('expandEscalation', () => {
  it('dates every rung relative to the expiry', () => {
    const reminders = expandEscalation(rule().escalationSchedule, '2026-03-14');
    expect(reminders.map((r) => r.scheduledOn)).toEqual([
      '2025-12-14',
      '2026-02-12',
      '2026-02-12',
    ]);
    expect(reminders.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it('expands a repeating rung into one reminder per day', () => {
    const schedule: EscalationStep[] = [
      {
        daysBefore: 7,
        channel: 'whatsapp',
        audience: 'client_contact',
        templateKey: 'urgent',
        repeatEveryDays: 1,
        repeatUntilDaysBefore: 1,
      },
    ];
    const reminders = expandEscalation(schedule, '2026-03-14');
    expect(reminders).toHaveLength(7);
    expect(reminders[0]!.scheduledOn).toBe('2026-03-07');
    expect(reminders[6]!.scheduledOn).toBe('2026-03-13');
  });

  it('expands post-expiry chasing', () => {
    const schedule: EscalationStep[] = [
      {
        daysBefore: -1,
        channel: 'email',
        audience: 'org_owner',
        templateKey: 'overdue',
        repeatEveryDays: 3,
        repeatUntilDaysBefore: -10,
      },
    ];
    const reminders = expandEscalation(schedule, '2026-03-14');
    expect(reminders.map((r) => r.scheduledOn)).toEqual([
      '2026-03-15',
      '2026-03-18',
      '2026-03-21',
      '2026-03-24',
    ]);
  });

  it('collapses rungs that land on the same day through the same channel', () => {
    const schedule: EscalationStep[] = [
      { daysBefore: 7, channel: 'email', audience: 'client_contact', templateKey: 'same' },
      {
        daysBefore: 10,
        channel: 'email',
        audience: 'client_contact',
        templateKey: 'same',
        repeatEveryDays: 3,
        repeatUntilDaysBefore: 4,
      },
    ];
    const reminders = expandEscalation(schedule, '2026-03-14');
    const days = reminders.map((r) => r.scheduledOn);
    expect(new Set(days).size).toBe(days.length);
  });

  it('gives every reminder a dedupe key that survives regeneration', () => {
    const first = expandEscalation(rule().escalationSchedule, '2026-03-14');
    const second = expandEscalation(rule().escalationSchedule, '2026-03-14');
    expect(first.map((r) => r.dedupeKey)).toEqual(second.map((r) => r.dedupeKey));
  });
});

describe('planRenewal', () => {
  it('freezes the rule it was computed under', () => {
    const plan = planRenewal(source(), rule({ version: 3 }), '2025-12-20');
    expect(plan.snapshot.ruleVersion).toBe(3);
    expect(plan.snapshot.leadTimeDays).toBe(90);
    expect(plan.snapshot.resolvedOn).toBe('2025-12-20');
    expect(plan.opensOn).toBe('2025-12-14');
    expect(plan.dueOn).toBe('2026-03-14');
  });

  it('keeps computing under the snapshot after the live rule changes', () => {
    const plan = planRenewal(source(), rule({ leadTimeDays: 90 }), '2025-12-20');
    const laterRule = rule({ leadTimeDays: 30, version: 2, effectiveFrom: '2026-01-01' });

    // The live rule now says 30 days, but the renewal that already exists still
    // opens at 90 — which is the whole point of snapshotting.
    expect(plan.snapshot.leadTimeDays).toBe(90);
    expect(renewalOpensOn(plan.dueOn, laterRule.leadTimeDays)).toBe('2026-02-12');
    expect(plan.opensOn).toBe('2025-12-14');
  });
});

describe('decideGeneration', () => {
  const context = (asOf: string, keys: string[] = []) => ({
    asOf,
    existingKeys: new Set(keys),
  });

  it('opens a renewal once the window is reached', () => {
    const decision = decideGeneration(source(), rule(), context('2025-12-14'));
    expect(decision.shouldOpen).toBe(true);
    expect(decision.skipReason).toBeNull();
  });

  it('holds off before the window opens', () => {
    const decision = decideGeneration(source(), rule(), context('2025-12-13'));
    expect(decision.shouldOpen).toBe(false);
    expect(decision.skipReason).toBe('not_yet_open');
  });

  it('opens a renewal for a document that has already expired', () => {
    // This is the backlog a firm discovers the day they import their spreadsheet.
    const decision = decideGeneration(
      source({ expiresOn: '2025-01-01' }),
      rule(),
      context('2026-01-01'),
    );
    expect(decision.shouldOpen).toBe(true);
  });

  it('is idempotent — a second run does not duplicate', () => {
    const key = renewalKey('licence', 'lic-1', '2026-03-14');
    const decision = decideGeneration(source(), rule(), context('2025-12-20', [key]));
    expect(decision.shouldOpen).toBe(false);
    expect(decision.skipReason).toBe('already_tracked');
  });

  it('skips cancelled and superseded records', () => {
    for (const status of ['cancelled', 'superseded'] as const) {
      const decision = decideGeneration(source({ status }), rule(), context('2026-01-01'));
      expect(decision.shouldOpen).toBe(false);
      expect(decision.skipReason).toBe('source_not_active');
    }
  });

  it('refuses to invent a lead time when no rule matches', () => {
    const decision = decideGeneration(source(), null, context('2026-01-01'));
    expect(decision.shouldOpen).toBe(false);
    expect(decision.skipReason).toBe('no_rule_matched');
    expect(decision.plan).toBeNull();
  });
});

describe('urgencyBucket', () => {
  it('buckets by days remaining', () => {
    expect(urgencyBucket('2026-03-14', '2026-03-15')).toBe('overdue');
    expect(urgencyBucket('2026-03-14', '2026-03-14')).toBe('critical');
    expect(urgencyBucket('2026-03-14', '2026-03-07')).toBe('critical');
    expect(urgencyBucket('2026-03-14', '2026-03-06')).toBe('urgent');
    expect(urgencyBucket('2026-03-14', '2026-02-12')).toBe('urgent');
    expect(urgencyBucket('2026-03-14', '2026-02-11')).toBe('upcoming');
    expect(urgencyBucket('2026-03-14', '2025-12-14')).toBe('upcoming');
    expect(urgencyBucket('2026-03-14', '2025-12-13')).toBe('later');
  });
});

describe('deriveDocStatus', () => {
  it('derives from the expiry and the governing lead time', () => {
    expect(deriveDocStatus('active', '2026-03-14', '2025-06-01', 90)).toBe('active');
    expect(deriveDocStatus('active', '2026-03-14', '2025-12-14', 90)).toBe('expiring');
    expect(deriveDocStatus('active', '2026-03-14', '2026-03-15', 90)).toBe('expired');
    expect(deriveDocStatus('active', null, '2026-03-15', 90)).toBe('active');
  });

  it('leaves cancelled and superseded records alone', () => {
    expect(deriveDocStatus('cancelled', '2020-01-01', '2026-01-01', 90)).toBe('cancelled');
    expect(deriveDocStatus('superseded', '2020-01-01', '2026-01-01', 90)).toBe('superseded');
  });
});

describe('dueReminders', () => {
  const reminders = expandEscalation(rule().escalationSchedule, '2026-03-14');

  it('returns the rungs that have come due and not yet been sent', () => {
    const due = dueReminders(reminders, '2026-02-12', new Set());
    expect(due).toHaveLength(3);
  });

  it('never resends a rung already in the log', () => {
    const sent = new Set([reminders[0]!.dedupeKey]);
    const due = dueReminders(reminders, '2026-02-12', sent);
    expect(due).toHaveLength(2);
    expect(due.every((r) => r.dedupeKey !== reminders[0]!.dedupeKey)).toBe(true);
  });

  it('catches up a rung that was missed while the worker was down', () => {
    // Scheduled 2025-12-14, run on 2026-01-20: it goes out late, not never.
    const due = dueReminders(reminders, '2026-01-20', new Set());
    expect(due.map((r) => r.scheduledOn)).toContain('2025-12-14');
  });

  it('reports the next rung still to come', () => {
    const next = nextReminder(reminders, '2026-01-01', new Set([reminders[0]!.dedupeKey]));
    expect(next?.scheduledOn).toBe('2026-02-12');
  });
});

describe('seeded rules', () => {
  const rules = seedRenewalRules();

  it('all pass structural validation', () => {
    for (const seeded of rules) {
      expect(validateRule(seeded), `${seeded.id} should be valid`).toEqual([]);
    }
  });

  it('never schedules a rung before its own renewal window opens', () => {
    for (const seeded of rules) {
      for (const step of seeded.escalationSchedule) {
        expect(step.daysBefore).toBeLessThanOrEqual(seeded.leadTimeDays);
      }
    }
  });

  it('pairs every WhatsApp rung with email somewhere in the ladder', () => {
    // Email has to be a genuine fallback, not a token one.
    for (const seeded of rules) {
      const channels = new Set(seeded.escalationSchedule.map((step) => step.channel));
      if (channels.has('whatsapp')) expect(channels.has('email')).toBe(true);
    }
  });

  it('resolves a rule for every seeded document type', () => {
    for (const seeded of rules) {
      const resolved = selectRule(rules, {
        orgId: 'org-1',
        docType: seeded.docType,
        jurisdiction: 'AE-DU',
        freeZone: 'IFZA',
        asOf: '2026-01-01',
      });
      expect(resolved?.docType).toBe(seeded.docType);
    }
  });

  it('produces a usable 90-day view for a freshly imported licence', () => {
    const licenceRule = selectRule(rules, {
      orgId: 'org-1',
      docType: 'trade_licence',
      jurisdiction: 'AE-DU',
      freeZone: 'IFZA',
      asOf: '2026-01-01',
    })!;
    const plan = planRenewal(source({ expiresOn: '2026-03-14' }), licenceRule, '2026-01-01');
    expect(plan.opensOn).toBe('2025-12-14');
    expect(urgencyBucket(plan.dueOn, '2026-01-01')).toBe('upcoming');
    expect(plan.reminders.length).toBeGreaterThan(5);
  });
});
