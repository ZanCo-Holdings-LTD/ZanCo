import { describe, expect, it } from 'vitest';
import {
  isRuleEffectiveOn,
  ruleHistory,
  ruleSpecificity,
  selectRule,
  validateRule,
  type RenewalRule,
} from './rules.js';

function rule(overrides: Partial<RenewalRule> = {}): RenewalRule {
  return {
    id: 'r',
    orgId: null,
    jurisdiction: null,
    freeZone: null,
    docType: 'trade_licence',
    leadTimeDays: 90,
    escalationSchedule: [
      { daysBefore: 30, channel: 'email', audience: 'client_contact', templateKey: 'remind' },
    ],
    version: 1,
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    notes: null,
    isActive: true,
    ...overrides,
  };
}

const criteria = {
  orgId: 'org-1',
  docType: 'trade_licence' as const,
  jurisdiction: 'AE-DU' as const,
  freeZone: 'IFZA',
  asOf: '2026-01-01',
};

describe('ruleSpecificity', () => {
  it('scores a catch-all lowest and a fully-qualified org rule highest', () => {
    expect(ruleSpecificity(rule(), criteria)).toBe(0);
    expect(ruleSpecificity(rule({ jurisdiction: 'AE-DU' }), criteria)).toBe(1);
    expect(ruleSpecificity(rule({ freeZone: 'IFZA' }), criteria)).toBe(2);
    expect(
      ruleSpecificity(rule({ orgId: 'org-1', jurisdiction: 'AE-DU', freeZone: 'IFZA' }), criteria),
    ).toBe(7);
  });

  it('excludes rules belonging to another firm', () => {
    expect(ruleSpecificity(rule({ orgId: 'org-2' }), criteria)).toBeNull();
  });

  it('excludes rules for another jurisdiction, free zone or document type', () => {
    expect(ruleSpecificity(rule({ jurisdiction: 'SA' }), criteria)).toBeNull();
    expect(ruleSpecificity(rule({ freeZone: 'DMCC' }), criteria)).toBeNull();
    expect(ruleSpecificity(rule({ docType: 'iqama' }), criteria)).toBeNull();
  });

  it('matches free zones case- and whitespace-insensitively', () => {
    expect(ruleSpecificity(rule({ freeZone: '  ifza ' }), criteria)).toBe(2);
  });
});

describe('isRuleEffectiveOn', () => {
  it('treats the window as inclusive of the start and exclusive of the end', () => {
    const dated = rule({ effectiveFrom: '2025-01-01', effectiveTo: '2026-01-01' });
    expect(isRuleEffectiveOn(dated, '2024-12-31')).toBe(false);
    expect(isRuleEffectiveOn(dated, '2025-01-01')).toBe(true);
    expect(isRuleEffectiveOn(dated, '2025-12-31')).toBe(true);
    expect(isRuleEffectiveOn(dated, '2026-01-01')).toBe(false);
  });

  it('ignores deactivated rules', () => {
    expect(isRuleEffectiveOn(rule({ isActive: false }), '2026-01-01')).toBe(false);
  });
});

describe('selectRule', () => {
  it('prefers the firm’s own rule over the system default', () => {
    const system = rule({ id: 'system', jurisdiction: 'AE-DU', freeZone: 'IFZA' });
    const firm = rule({ id: 'firm', orgId: 'org-1' });
    expect(selectRule([system, firm], criteria)?.id).toBe('firm');
  });

  it('prefers a free-zone rule over a jurisdiction rule', () => {
    const byJurisdiction = rule({ id: 'j', jurisdiction: 'AE-DU' });
    const byFreeZone = rule({ id: 'fz', freeZone: 'IFZA' });
    expect(selectRule([byJurisdiction, byFreeZone], criteria)?.id).toBe('fz');
  });

  it('returns null rather than a hardcoded default when nothing matches', () => {
    expect(selectRule([rule({ docType: 'iqama' })], criteria)).toBeNull();
    expect(selectRule([], criteria)).toBeNull();
  });

  it('picks the version in force on the resolution date, not the newest', () => {
    const v1 = rule({ id: 'v1', version: 1, effectiveFrom: '2024-01-01', effectiveTo: '2026-01-01', leadTimeDays: 90 });
    const v2 = rule({ id: 'v2', version: 2, effectiveFrom: '2026-01-01', leadTimeDays: 45 });

    expect(selectRule([v1, v2], { ...criteria, asOf: '2025-06-01' })?.id).toBe('v1');
    expect(selectRule([v1, v2], { ...criteria, asOf: '2026-06-01' })?.id).toBe('v2');
  });

  it('breaks a tie on version, then on start date', () => {
    const older = rule({ id: 'a', version: 1 });
    const newer = rule({ id: 'b', version: 2 });
    expect(selectRule([older, newer], criteria)?.id).toBe('b');

    const sameVersionEarlier = rule({ id: 'c', version: 5, effectiveFrom: '2024-01-01' });
    const sameVersionLater = rule({ id: 'd', version: 5, effectiveFrom: '2025-01-01' });
    expect(selectRule([sameVersionEarlier, sameVersionLater], criteria)?.id).toBe('d');
  });

  it('is deterministic regardless of the order rules come out of the database', () => {
    const rules = [
      rule({ id: 'a', jurisdiction: 'AE-DU' }),
      rule({ id: 'b', orgId: 'org-1' }),
      rule({ id: 'c', freeZone: 'IFZA' }),
      rule({ id: 'd' }),
    ];
    const forward = selectRule(rules, criteria)?.id;
    const backward = selectRule([...rules].reverse(), criteria)?.id;
    expect(forward).toBe('b');
    expect(backward).toBe('b');
  });
});

describe('ruleHistory', () => {
  it('lists every version that has governed, newest first', () => {
    const v1 = rule({ id: 'v1', version: 1, effectiveFrom: '2024-01-01', effectiveTo: '2026-01-01' });
    const v2 = rule({ id: 'v2', version: 2, effectiveFrom: '2026-01-01' });
    const other = rule({ id: 'other', docType: 'iqama' });

    const history = ruleHistory([v1, v2, other], {
      orgId: 'org-1',
      docType: 'trade_licence',
      jurisdiction: 'AE-DU',
      freeZone: 'IFZA',
    });
    expect(history.map((r) => r.id)).toEqual(['v2', 'v1']);
  });
});

describe('validateRule', () => {
  it('accepts a well-formed rule', () => {
    expect(validateRule(rule())).toEqual([]);
  });

  it('rejects a rung that fires before the renewal opens', () => {
    const issues = validateRule(
      rule({
        leadTimeDays: 30,
        escalationSchedule: [
          { daysBefore: 90, channel: 'email', audience: 'client_contact', templateKey: 'x' },
        ],
      }),
    );
    expect(issues.join(' ')).toContain('would never be sent');
  });

  it('rejects an empty ladder', () => {
    expect(validateRule(rule({ escalationSchedule: [] })).join(' ')).toContain('at least one step');
  });

  it('rejects a negative lead time and an inverted effective window', () => {
    expect(validateRule(rule({ leadTimeDays: -1 })).join(' ')).toContain('non-negative');
    expect(
      validateRule(rule({ effectiveFrom: '2026-01-01', effectiveTo: '2025-01-01' })).join(' '),
    ).toContain('strictly before');
  });

  it('rejects a repeat that counts the wrong way', () => {
    const issues = validateRule(
      rule({
        escalationSchedule: [
          {
            daysBefore: 7,
            channel: 'whatsapp',
            audience: 'client_contact',
            templateKey: 'x',
            repeatEveryDays: 1,
            repeatUntilDaysBefore: 14,
          },
        ],
      }),
    );
    expect(issues.join(' ')).toContain('counts down towards expiry');
  });
});
