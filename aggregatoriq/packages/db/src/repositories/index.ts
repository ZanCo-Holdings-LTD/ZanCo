/**
 * Every database access in the product goes through one of these.
 *
 * Not for tidiness: RLS depends on a transaction-local session variable, and a
 * repository function that takes a `Transaction` cannot be called from outside
 * one. Ad-hoc queries scattered through route handlers are how a query ends up
 * running with no tenant scope at all.
 */
// Namespaced so a call site reads `repositories.recon.listVariances(...)` and it
// is obvious which layer is being touched.
export * as organisations from './organisations.js';
export * as branches from './branches.js';
export * as ingestion from './ingestion.js';
export * as canonical from './canonical.js';
export * as recon from './recon.js';
export * as disputes from './disputes.js';
export * as analytics from './analytics.js';

// Row shapes, re-exported flat. A namespace export does not carry types through,
// and every consumer of a repository needs the shape it returns.
export type { MembershipRecord, OrganisationRecord } from './organisations.js';
export type { AggregatorAccountRecord, BranchRecord } from './branches.js';
export type {
  RegisterDocumentInput,
  RegisterDocumentResult,
  StatementSummary,
} from './ingestion.js';
export type { OrderUpsert, PayoutUpsert } from './canonical.js';
export type {
  PersistRunInput,
  ReconRunSummary,
  RecoverySummaryRow,
  VarianceRecord,
} from './recon.js';
export type { DisputeRecord } from './disputes.js';
export type { AnalyticsEventName, NorthStar } from './analytics.js';
