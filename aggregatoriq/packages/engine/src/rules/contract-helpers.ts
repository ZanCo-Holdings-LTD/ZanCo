/**
 * Re-exports for run rules, kept separate so a rule file imports only what it
 * uses and the dependency direction stays obvious in review.
 */
export { formatMinor, formatRate, linesOfType, rowIds, sumLines } from './contract.js';
export type { OrderRule, RunRule, OrderRuleContext, RunRuleContext, Rule } from './contract.js';
export { isDeductionLineType as isDeduction } from '@aggregatoriq/core';
