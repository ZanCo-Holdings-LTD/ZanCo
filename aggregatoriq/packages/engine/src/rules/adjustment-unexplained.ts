/**
 * ADJUSTMENT_UNEXPLAINED — a deduction with no reference and no description.
 *
 * Marked `investigate`, not `recoverable`, and that distinction is doing real
 * work. Unexplained adjustments are often legitimate once someone asks: a
 * marketing contribution agreed by email, an equipment charge, a
 * previously-agreed settlement. Counting them in the headline recovery figure
 * would inflate it with money that is not owed, and the first time an operator
 * takes that number to their account manager and is told "that was the fridge",
 * the credibility of every other figure goes with it.
 *
 * So it appears in the variance list, it appears in the dispute pack as a
 * request for explanation, and it does not appear in the recovery total.
 */
import { isMaterial } from '../materiality.js';
import type { VarianceDraft } from '../variance.js';
import { formatMinor, linesOfType, type RunRule } from './contract.js';

export const adjustmentUnexplained: RunRule = {
  name: 'adjustment_unexplained',
  kind: 'run',
  causeCodes: ['ADJUSTMENT_UNEXPLAINED'],
  evaluate: ({ lines, materiality, currency }) => {
    const unexplained = linesOfType(lines, 'adjustment', 'other', 'penalty')
      .filter((line) => line.amountMinor < 0)
      .filter((line) => {
        const hasReference =
          (line.externalOrderId !== null && line.externalOrderId.trim() !== '') ||
          (line.reference !== null && line.reference.trim() !== '');
        const hasDescription = line.description !== null && line.description.trim().length > 3;
        return !hasReference && !hasDescription;
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    return unexplained.flatMap<VarianceDraft>((line) => {
      const delta = 0 - line.amountMinor;
      if (!isMaterial(delta, materiality)) return [];

      return [
        {
          causeCode: 'ADJUSTMENT_UNEXPLAINED',
          orderId: null,
          expectedMinor: 0,
          actualMinor: line.amountMinor,
          currency,
          confidence: 0.75,
          evidence: {
            rule: 'adjustment_unexplained',
            sourceRowIds: [line.sourceRowId],
            computation:
              `A ${line.lineType} of ${formatMinor(line.amountMinor, currency)} was deducted with ` +
              `no order reference and no description. Raised for explanation rather than as a ` +
              `claim — it is not counted in the recovery total until the aggregator accounts for it.`,
            inputs: {
              payoutId: line.payoutId,
              lineType: line.lineType,
              amountMinor: line.amountMinor,
              description: line.description,
              reference: line.reference,
            },
          },
        },
      ];
    });
  },
};
