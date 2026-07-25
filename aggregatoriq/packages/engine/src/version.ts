/**
 * The engine version, recorded on every reconciliation run.
 *
 * Bump this whenever a change could alter the numbers a rule produces: a new
 * rule, a changed threshold, a fixed rounding bug. Historical runs keep their
 * old version, which is what lets someone six months from now explain why a
 * March run said 4,312.50 and a re-run today says 4,480.00 — the answer is
 * visible rather than a mystery that costs you the customer's confidence.
 *
 * Do NOT bump it for changes that cannot move a number (comments, refactors,
 * UI). A version churn that does not correspond to a behaviour change makes the
 * field useless for exactly the question it exists to answer.
 */
export const ENGINE_VERSION = '1.0.0';

/**
 * Rule-set revision, bumped when the set of registered rules changes even if
 * no individual rule's arithmetic did. Together with ENGINE_VERSION this pins
 * down what produced a given result.
 */
export const RULE_SET_VERSION = '1.0.0';
