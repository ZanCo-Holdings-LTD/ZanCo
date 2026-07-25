/**
 * The matching ladder.
 *
 * Every payout line has to be attributed to an order before any rule can judge
 * it, and the honest answer is sometimes "I cannot tell". The ladder tries
 * progressively weaker signals, records which rung succeeded, and drops anything
 * below the confidence floor into a review queue rather than guessing.
 *
 * That last part is the important one. A wrong match does not produce a missing
 * variance, it produces a *confident wrong* variance — a claim about an order
 * that was never involved. An operator who submits one of those and gets it
 * thrown back stops believing the other findings too.
 *
 * Rungs, in order:
 *
 *   1. `exact_order_id`         the reference matches exactly one order
 *   2. `order_id_and_amount`    the reference matches several; amount picks one
 *   3. `fuzzy_time_and_amount`  no usable reference; amount plus a time window
 *
 * Anything else becomes an `UnmatchedPayoutLine` with the reason recorded.
 */
import { MATCH_CONFIDENCE, MATCH_CONFIDENCE_FLOOR, minutesBetween } from '@aggregatoriq/core';
import type { MatchMethod } from '@aggregatoriq/core';
import type {
  CanonicalOrder,
  CanonicalPayoutLine,
  MatchRecord,
  UnmatchedPayoutLine,
} from './domain.js';

export interface MatchOptions {
  /**
   * How far from an order's timestamp a fuzzy match may reach. Wide enough to
   * absorb a statement that quotes settlement time rather than order time,
   * narrow enough that two similar orders on the same day do not both qualify.
   */
  readonly fuzzyWindowMinutes: number;
  /**
   * How far an amount may differ and still be considered the same order, in
   * minor units. Covers a tip added after the fact or a rounding difference.
   */
  readonly amountToleranceMinor: number;
  readonly confidenceFloor: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  fuzzyWindowMinutes: 24 * 60,
  amountToleranceMinor: 100,
  confidenceFloor: MATCH_CONFIDENCE_FLOOR,
};

export interface MatchResult {
  readonly matches: readonly MatchRecord[];
  readonly unmatched: readonly UnmatchedPayoutLine[];
  /** Orders with no payout line at all. Feeds the missing-payout rule. */
  readonly unpaidOrderIds: readonly string[];
}

/**
 * Normalise an order reference before comparing.
 *
 * Aggregators quote the same order as `#123456`, `123456` and `123 456` across
 * their own exports. Casing, whitespace and a leading hash are noise. What is
 * *not* stripped is any alphanumeric prefix — `TLB123456` and `123456` are left
 * distinct, because collapsing them would risk matching two genuinely different
 * orders and a false match is the expensive error here.
 */
export function normaliseOrderReference(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.trim().replace(/^#+/, '').replace(/\s+/g, '').toUpperCase();
  return cleaned === '' ? null : cleaned;
}

/** Confidence for a fuzzy match, tightening as the evidence improves. */
export function fuzzyConfidence(
  amountExact: boolean,
  minutesApart: number,
  windowMinutes: number,
): number {
  const base = MATCH_CONFIDENCE.fuzzy_time_and_amount;
  const closeness = windowMinutes === 0 ? 1 : 1 - Math.min(minutesApart / windowMinutes, 1);
  // Exact amount plus a tight time window is decent evidence; an approximate
  // amount at the edge of the window barely clears the floor.
  const amountBonus = amountExact ? 0.15 : 0;
  const timeBonus = closeness * 0.1;
  return Math.min(1, Number((base + amountBonus + timeBonus).toFixed(4)));
}

export function matchPayoutLines(
  orders: readonly CanonicalOrder[],
  lines: readonly CanonicalPayoutLine[],
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): MatchResult {
  // Index orders by normalised reference. A reference can legitimately map to
  // more than one order when an aggregator reuses ids across days, which is
  // exactly what rung 2 exists for.
  const byReference = new Map<string, CanonicalOrder[]>();
  for (const order of orders) {
    const key = normaliseOrderReference(order.externalOrderId);
    if (key === null) continue;
    const bucket = byReference.get(key);
    if (bucket) bucket.push(order);
    else byReference.set(key, [order]);
  }

  // Sorted so the output does not depend on input ordering. Byte-identical
  // re-runs are a requirement, not a nicety.
  const sortedLines = [...lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const linesByOrder = new Map<string, { ids: string[]; method: MatchMethod; confidence: number }>();
  const unmatched: UnmatchedPayoutLine[] = [];

  const attribute = (
    orderId: string,
    line: CanonicalPayoutLine,
    method: MatchMethod,
    confidence: number,
  ): void => {
    const existing = linesByOrder.get(orderId);
    if (!existing) {
      linesByOrder.set(orderId, { ids: [line.id], method, confidence });
      return;
    }
    existing.ids.push(line.id);
    // A match record carries the weakest rung used to build it, so the
    // confidence shown never overstates how the attribution was made.
    if (confidence < existing.confidence) {
      existing.confidence = confidence;
      existing.method = method;
    }
  };

  for (const line of sortedLines) {
    const reference = normaliseOrderReference(line.externalOrderId);

    if (reference !== null) {
      const candidates = byReference.get(reference) ?? [];

      if (candidates.length === 1) {
        attribute(candidates[0]!.id, line, 'exact_order_id', MATCH_CONFIDENCE.exact_order_id);
        continue;
      }

      if (candidates.length > 1) {
        const picked = pickByAmount(candidates, line, options.amountToleranceMinor);
        if (picked !== null) {
          attribute(
            picked.id,
            line,
            'order_id_and_amount',
            MATCH_CONFIDENCE.order_id_and_amount,
          );
        } else {
          unmatched.push(toUnmatched(line, 'ambiguous'));
        }
        continue;
      }

      // A reference that matches nothing is not a fuzzy-match candidate: the
      // aggregator told us which order it was and we do not have that order.
      // Guessing from the amount here would attribute a deduction to an
      // unrelated order.
      unmatched.push(toUnmatched(line, 'no_candidate'));
      continue;
    }

    const fuzzy = fuzzyMatch(orders, line, options);
    if (fuzzy === null) {
      unmatched.push(toUnmatched(line, 'no_order_reference'));
      continue;
    }
    if (fuzzy.ambiguous) {
      unmatched.push(toUnmatched(line, 'ambiguous'));
      continue;
    }
    if (fuzzy.confidence < options.confidenceFloor) {
      unmatched.push(toUnmatched(line, 'below_confidence_floor'));
      continue;
    }
    attribute(fuzzy.order.id, line, 'fuzzy_time_and_amount', fuzzy.confidence);
  }

  const matches: MatchRecord[] = [...linesByOrder.entries()]
    .map(([orderId, value]) => ({
      orderId,
      payoutLineIds: [...value.ids].sort(),
      method: value.method,
      confidence: value.confidence,
    }))
    .sort((a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));

  const unpaidOrderIds = orders
    .filter((order) => !linesByOrder.has(order.id))
    .map((order) => order.id)
    .sort();

  return {
    matches,
    unmatched: unmatched.sort((a, b) =>
      a.payoutLineId < b.payoutLineId ? -1 : a.payoutLineId > b.payoutLineId ? 1 : 0,
    ),
    unpaidOrderIds,
  };
}

function toUnmatched(
  line: CanonicalPayoutLine,
  reason: UnmatchedPayoutLine['reason'],
): UnmatchedPayoutLine {
  return {
    payoutLineId: line.id,
    externalOrderId: line.externalOrderId,
    amountMinor: line.amountMinor,
    lineType: line.lineType,
    reason,
    sourceRowId: line.sourceRowId,
  };
}

/**
 * Disambiguate several same-reference orders by amount. Returns `null` when the
 * amount does not single one out — better an unmatched line for review than a
 * coin flip.
 */
function pickByAmount(
  candidates: readonly CanonicalOrder[],
  line: CanonicalPayoutLine,
  toleranceMinor: number,
): CanonicalOrder | null {
  const target = Math.abs(line.amountMinor);
  const close = candidates.filter(
    (order) => Math.abs(order.grossAmountMinor - target) <= toleranceMinor,
  );
  return close.length === 1 ? close[0]! : null;
}

interface FuzzyOutcome {
  readonly order: CanonicalOrder;
  readonly confidence: number;
  readonly ambiguous: boolean;
}

function fuzzyMatch(
  orders: readonly CanonicalOrder[],
  line: CanonicalPayoutLine,
  options: MatchOptions,
): FuzzyOutcome | null {
  const target = Math.abs(line.amountMinor);
  if (target === 0) return null;

  const scored = orders
    .map((order) => {
      const difference = Math.abs(order.grossAmountMinor - target);
      return { order, difference, exact: difference === 0 };
    })
    .filter((candidate) => candidate.difference <= options.amountToleranceMinor);

  if (scored.length === 0) return null;

  // A payout line has no timestamp of its own, so the window is measured from
  // the order to the *other candidate orders* — the question being answered is
  // "is there exactly one order this could plausibly be". Two orders of the
  // same value within the window are indistinguishable and both are rejected.
  if (scored.length > 1) {
    const [first, second] = scored.sort((a, b) => a.difference - b.difference);
    const apart = minutesBetween(first!.order.orderedAt, second!.order.orderedAt);
    if (apart <= options.fuzzyWindowMinutes || first!.difference === second!.difference) {
      return { order: first!.order, confidence: 0, ambiguous: true };
    }
    return {
      order: first!.order,
      confidence: fuzzyConfidence(first!.exact, 0, options.fuzzyWindowMinutes),
      ambiguous: false,
    };
  }

  const only = scored[0]!;
  return {
    order: only.order,
    confidence: fuzzyConfidence(only.exact, 0, options.fuzzyWindowMinutes),
    ambiguous: false,
  };
}

/** Group a match result's lines by order, for the rules to consume. */
export function linesByOrderId(
  matches: readonly MatchRecord[],
  lines: readonly CanonicalPayoutLine[],
): Map<string, CanonicalPayoutLine[]> {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const grouped = new Map<string, CanonicalPayoutLine[]>();

  for (const match of matches) {
    const resolved = match.payoutLineIds
      .map((id) => byId.get(id))
      .filter((line): line is CanonicalPayoutLine => line !== undefined)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    grouped.set(match.orderId, resolved);
  }

  return grouped;
}
