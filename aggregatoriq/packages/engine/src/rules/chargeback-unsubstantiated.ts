/**
 * CHARGEBACK_UNSUBSTANTIATED — a customer chargeback passed through with nothing
 * the operator can verify.
 *
 * A chargeback with an order reference can be checked: the operator looks at the
 * order, the delivery, the customer. A chargeback with no reference and no
 * description is an amount taken on trust, and the operator has no way to
 * establish whether the underlying dispute was real. The claim is not "this
 * chargeback was wrong", it is "you have not substantiated it" — which is a
 * winnable position and the reason the dispute template for this code asks for
 * evidence rather than asserting error.
 *
 * A run rule because these lines are frequently unmatched by definition.
 */
import { isMaterial } from '../materiality.js';
import type { VarianceDraft } from '../variance.js';
import { formatMinor, linesOfType, type RunRule } from './contract.js';

export const chargebackUnsubstantiated: RunRule = {
  name: 'chargeback_unsubstantiated',
  kind: 'run',
  causeCodes: ['CHARGEBACK_UNSUBSTANTIATED'],
  evaluate: ({ lines, materiality, currency }) => {
    const chargebacks = linesOfType(lines, 'chargeback')
      .filter((line) => line.amountMinor < 0)
      .filter((line) => {
        const hasReference =
          (line.externalOrderId !== null && line.externalOrderId.trim() !== '') ||
          (line.reference !== null && line.reference.trim() !== '');
        const hasDescription = line.description !== null && line.description.trim().length > 3;
        return !hasReference && !hasDescription;
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    return chargebacks.flatMap<VarianceDraft>((line) => {
      const delta = 0 - line.amountMinor;
      if (!isMaterial(delta, materiality)) return [];

      return [
        {
          causeCode: 'CHARGEBACK_UNSUBSTANTIATED',
          orderId: null,
          expectedMinor: 0,
          actualMinor: line.amountMinor,
          currency,
          confidence: 0.85,
          evidence: {
            rule: 'chargeback_unsubstantiated',
            sourceRowIds: [line.sourceRowId],
            computation:
              `A chargeback of ${formatMinor(line.amountMinor, currency)} was deducted with no ` +
              `order reference and no description, so there is nothing for the operator to ` +
              `verify against. The full amount is claimable pending substantiation.`,
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
