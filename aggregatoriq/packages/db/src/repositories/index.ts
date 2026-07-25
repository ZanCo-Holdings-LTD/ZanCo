/**
 * Every database access in the product goes through one of these.
 *
 * Not for tidiness: RLS depends on a transaction-local session variable, and a
 * repository function that takes a `Transaction` cannot be called from outside
 * one. Ad-hoc queries scattered through route handlers are how a query ends up
 * running with no tenant scope at all.
 */
export * as organisations from './organisations.js';
export * as branches from './branches.js';
export * as ingestion from './ingestion.js';
export * as canonical from './canonical.js';
export * as recon from './recon.js';
export * as disputes from './disputes.js';
export * as analytics from './analytics.js';
