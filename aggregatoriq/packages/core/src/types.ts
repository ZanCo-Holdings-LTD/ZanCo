/**
 * Domain vocabulary shared by the database, the engine, the parsers and the web
 * app. Mirrored as Postgres enums in the migrations, kept in step by a test that
 * reads the labels back out of the live catalogue.
 */

export const MEMBER_ROLES = ['owner', 'admin', 'analyst', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

const ROLE_RANK: Record<MemberRole, number> = { owner: 40, admin: 30, analyst: 20, viewer: 10 };

export function hasAtLeastRole(actual: MemberRole, required: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const COUNTRIES = ['AE', 'SA', 'KW', 'QA', 'BH', 'OM', 'GB'] as const;
export type Country = (typeof COUNTRIES)[number];

/**
 * The aggregators. Codes are stable identifiers used in parser registration and
 * dispute-pack templates, so they must never be renamed once shipped.
 */
export const AGGREGATOR_CODES = [
  'talabat',
  'hungerstation',
  'jahez',
  'deliveroo',
  'careem',
  'noon',
] as const;
export type AggregatorCode = (typeof AGGREGATOR_CODES)[number];

export const AGGREGATOR_NAMES: Record<AggregatorCode, string> = {
  talabat: 'Talabat',
  hungerstation: 'HungerStation',
  jahez: 'Jahez',
  deliveroo: 'Deliveroo',
  careem: 'Careem',
  noon: 'Noon Food',
};

/** Which country each aggregator is primarily reconciled for in v1. */
export const AGGREGATOR_COUNTRIES: Record<AggregatorCode, readonly Country[]> = {
  talabat: ['AE', 'SA', 'KW', 'QA', 'BH', 'OM'],
  hungerstation: ['SA', 'BH'],
  jahez: ['SA'],
  deliveroo: ['AE', 'QA', 'KW', 'GB'],
  careem: ['AE', 'SA'],
  noon: ['AE', 'SA'],
};

// ---------------------------------------------------------------------------
// Raw layer
// ---------------------------------------------------------------------------

export const SOURCE_DOCUMENT_KINDS = [
  'payout_statement',
  'order_export',
  'invoice',
  'adjustment_report',
  'unknown',
] as const;
export type SourceDocumentKind = (typeof SOURCE_DOCUMENT_KINDS)[number];

export const RECEIVED_VIA = ['upload', 'email', 'free_audit'] as const;
export type ReceivedVia = (typeof RECEIVED_VIA)[number];

export const PARSE_STATUSES = [
  'pending',
  'parsed',
  'partially_parsed',
  'needs_review',
  'failed',
] as const;
export type ParseStatus = (typeof PARSE_STATUSES)[number];

/**
 * Which rung of the parsing ladder produced a document's rows. Recorded per
 * document because it changes how much the output should be trusted, and
 * because `llm` rows are the ones the eval harness samples.
 */
export const PARSE_METHODS = ['deterministic', 'llm', 'manual'] as const;
export type ParseMethod = (typeof PARSE_METHODS)[number];

// ---------------------------------------------------------------------------
// Canonical layer
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = [
  'delivered',
  'cancelled',
  'rejected',
  'refunded',
  'partially_refunded',
  'unknown',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Order statuses that should result in the operator being paid. Used by the
 * missing-payout and cancelled-order rules, and deliberately narrow: an order
 * of `unknown` status generates no variance, because a claim built on a status
 * we could not read is a claim that gets rejected.
 */
export const PAYABLE_ORDER_STATUSES = ['delivered', 'partially_refunded'] as const;

export function isPayableStatus(status: OrderStatus): boolean {
  return (PAYABLE_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

/**
 * The line types a payout can be built from.
 *
 * Sign convention, applied by the parsers and relied on by every rule:
 * `gross_sale` is positive, everything the aggregator keeps or claws back is
 * negative. A parser that emits a positive commission is a bug the canonical
 * mapper rejects rather than quietly negates.
 */
export const PAYOUT_LINE_TYPES = [
  'gross_sale',
  'commission',
  'delivery_fee',
  'promo_funding',
  'promo_recharge',
  'refund',
  'cancellation',
  'chargeback',
  'vat',
  'adjustment',
  'penalty',
  'tip',
  'other',
] as const;
export type PayoutLineType = (typeof PAYOUT_LINE_TYPES)[number];

/** Line types that must never be positive on a payout. */
export const DEDUCTION_LINE_TYPES = [
  'commission',
  'promo_recharge',
  'refund',
  'cancellation',
  'chargeback',
  'penalty',
] as const satisfies readonly PayoutLineType[];

export function isDeductionLineType(type: PayoutLineType): boolean {
  return (DEDUCTION_LINE_TYPES as readonly PayoutLineType[]).includes(type);
}

export const VAT_TREATMENTS = [
  'commission_on_net',
  'commission_on_gross',
  'zero_rated',
  'exempt',
] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

// ---------------------------------------------------------------------------
// Derived layer
// ---------------------------------------------------------------------------

/**
 * The matching ladder, in the order it is attempted. Each rung records how it
 * matched, so a variance can always answer "why do you think this payout line
 * belongs to this order".
 */
export const MATCH_METHODS = [
  'exact_order_id',
  'order_id_and_amount',
  'fuzzy_time_and_amount',
  'manual',
] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const MATCH_CONFIDENCE: Record<MatchMethod, number> = {
  exact_order_id: 1,
  order_id_and_amount: 0.95,
  fuzzy_time_and_amount: 0.7,
  manual: 1,
};

/**
 * Below this, nothing is matched. The candidate becomes an unmatched item for
 * human review rather than a silent guess, because a wrong match produces a
 * confident variance about an order that was never involved.
 */
export const MATCH_CONFIDENCE_FLOOR = 0.6;

export const RECON_RUN_STATUSES = ['running', 'completed', 'failed'] as const;
export type ReconRunStatus = (typeof RECON_RUN_STATUSES)[number];

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}
