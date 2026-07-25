/**
 * DUPLICATE_DEDUCTION — the same deduction applied more than once.
 *
 * A run rule, because the two copies are frequently in different payouts: a
 * commission deducted in the 1–15 statement and again in the 16–31 one is
 * invisible to anyone looking at either statement alone, and is exactly the
 * error a per-statement review will never find.
 *
 * The grouping key is deliberately strict — line type, order reference (or an
 * explicit statement reference) and exact amount. Two identical round-number
 * `adjustment` lines with no reference at all are *not* treated as duplicates,
 * because a restaurant can legitimately incur the same fee twice and a false
 * duplicate claim is the kind of thing that gets a whole dispute pack dismissed.
 */
import { isMaterial } from '../materiality.js';
import type { CanonicalPayoutLine } from '../domain.js';
import type { VarianceDraft } from '../variance.js';
import { formatMinor, isDeduction, type RunRule } from './contract-helpers.js';

export const duplicateDeduction: RunRule = {
  name: 'duplicate_deduction',
  kind: 'run',
  causeCodes: ['DUPLICATE_DEDUCTION'],
  evaluate: ({ lines, matches, materiality, currency }) => {
    const orderIdByLine = new Map<string, string>();
    for (const match of matches) {
      for (const lineId of match.payoutLineIds) orderIdByLine.set(lineId, match.orderId);
    }

    const groups = new Map<string, CanonicalPayoutLine[]>();

    for (const line of lines) {
      if (!isDeduction(line.lineType)) continue;

      // Needs an identifier of its own. Without one there is no way to tell a
      // duplicate from a second, genuine, identical charge.
      const identity = line.externalOrderId ?? line.reference;
      if (identity === null || identity.trim() === '') continue;

      const key = [line.lineType, identity.trim().toUpperCase(), line.amountMinor].join('|');
      const bucket = groups.get(key);
      if (bucket) bucket.push(line);
      else groups.set(key, [line]);
    }

    const drafts: VarianceDraft[] = [];

    for (const [key, bucket] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (bucket.length < 2) continue;

      const sorted = [...bucket].sort((a, b) => (a.id < b.id ? -1 : 1));
      const unit = sorted[0]!.amountMinor;
      const expected = unit;
      const actual = unit * sorted.length;
      const delta = expected - actual;

      if (!isMaterial(delta, materiality)) continue;

      const identity = key.split('|')[1] ?? '';
      const orderId = orderIdByLine.get(sorted[0]!.id) ?? null;

      drafts.push({
        causeCode: 'DUPLICATE_DEDUCTION',
        orderId,
        expectedMinor: expected,
        actualMinor: actual,
        currency,
        // Same line type, same reference and the same amount to the fils is
        // strong evidence, but a genuine repeat charge is conceivable, so this
        // does not claim certainty.
        confidence: 0.9,
        evidence: {
          rule: 'duplicate_deduction',
          sourceRowIds: sorted.map((line) => line.sourceRowId),
          computation:
            `${sorted.length} identical ${sorted[0]!.lineType} deductions of ` +
            `${formatMinor(unit, currency)} against reference ${identity} appear across the ` +
            `statements. One is due; ${sorted.length - 1} ` +
            `${sorted.length - 1 === 1 ? 'is' : 'are'} duplicated, totalling ` +
            `${formatMinor(delta, currency)}.`,
          inputs: {
            lineType: sorted[0]!.lineType,
            reference: identity,
            occurrences: sorted.length,
            unitAmountMinor: unit,
            payoutIds: [...new Set(sorted.map((line) => line.payoutId))].sort().join(', '),
          },
        },
      });
    }

    return drafts;
  },
};
