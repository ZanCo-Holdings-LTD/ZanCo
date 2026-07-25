/**
 * Drizzle schema — the typed view of the migrations.
 *
 * `packages/db/migrations` is the source of truth; this file is what queries are
 * built against. `tests/schema-parity.pg.test.ts` compares every table and
 * column here against the live catalogue, so the two cannot drift silently.
 *
 * `date({ mode: 'string' })` throughout: statement periods and payout dates are
 * calendar dates, not instants. Reading them as JS `Date` is how an order lands
 * in the wrong period and is reported as missing.
 */
import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AGGREGATOR_CODES,
  DISPUTE_OUTCOMES,
  MATCH_METHODS,
  MEMBER_ROLES,
  ORDER_STATUSES,
  PARSE_METHODS,
  PARSE_STATUSES,
  PAYOUT_LINE_TYPES,
  RECEIVED_VIA,
  RECON_RUN_STATUSES,
  RECOVERABILITY,
  SOURCE_DOCUMENT_KINDS,
  VARIANCE_STATUSES,
  VAT_TREATMENTS,
} from '@aggregatoriq/core';

// ---------------------------------------------------------------------------
// Enums — labels come from @aggregatoriq/core so the two cannot drift.
// ---------------------------------------------------------------------------

export const memberRoleEnum = pgEnum('member_role', MEMBER_ROLES);
export const aggregatorCodeEnum = pgEnum('aggregator_code', AGGREGATOR_CODES);
export const sourceDocumentKindEnum = pgEnum('source_document_kind', SOURCE_DOCUMENT_KINDS);
export const receivedViaEnum = pgEnum('received_via', RECEIVED_VIA);
export const parseStatusEnum = pgEnum('parse_status', PARSE_STATUSES);
export const parseMethodEnum = pgEnum('parse_method', PARSE_METHODS);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const payoutLineTypeEnum = pgEnum('payout_line_type', PAYOUT_LINE_TYPES);
export const vatTreatmentEnum = pgEnum('vat_treatment', VAT_TREATMENTS);
export const matchMethodEnum = pgEnum('match_method', MATCH_METHODS);
export const reconRunStatusEnum = pgEnum('recon_run_status', RECON_RUN_STATUSES);
export const varianceStatusEnum = pgEnum('variance_status', VARIANCE_STATUSES);
export const disputeOutcomeEnum = pgEnum('dispute_outcome', DISPUTE_OUTCOMES);
export const recoverabilityEnum = pgEnum('recoverability', RECOVERABILITY);
export const feeBearerEnum = pgEnum('fee_bearer', ['aggregator', 'operator', 'customer'] as const);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing', 'active', 'past_due', 'canceled', 'paused',
] as const);
export const paymentProviderEnum = pgEnum('payment_provider', [
  'stripe', 'moyasar', 'tap', 'manual',
] as const);
export const planCodeEnum = pgEnum('plan_code', [
  'standard', 'multi_branch', 'recovery_share',
] as const);

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const appUsers = pgTable('app_users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  country: char('country', { length: 2 }).notNull().default('AE'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('AED'),
  defaultLocale: text('default_locale').notNull().default('en'),
  materialityThresholdMinor: bigint('materiality_threshold_minor', { mode: 'number' })
    .notNull()
    .default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    index('org_members_user_idx').on(table.userId),
  ],
);

export const brands = pgTable(
  'brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('brands_name_unique').on(table.orgId, table.name)],
);

export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  city: text('city'),
  timezone: text('timezone').notNull().default('Asia/Dubai'),
  currency: char('currency', { length: 3 }).notNull().default('AED'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Aggregator configuration
// ---------------------------------------------------------------------------

export const aggregators = pgTable('aggregators', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: aggregatorCodeEnum('code').notNull().unique(),
  name: text('name').notNull(),
  countries: char('countries', { length: 2 }).array().notNull().default([]),
  statementFormats: jsonb('statement_formats').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const branchAggregatorAccounts = pgTable(
  'branch_aggregator_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    aggregatorId: uuid('aggregator_id').notNull().references(() => aggregators.id),
    externalStoreId: text('external_store_id').notNull(),
    contractedCommissionRate: numeric('contracted_commission_rate', { precision: 6, scale: 4 })
      .notNull(),
    promoShareTerms: jsonb('promo_share_terms')
      .notNull()
      .default({ terms: [], defaultAggregatorSharePct: 0 }),
    vatTreatment: vatTreatmentEnum('vat_treatment').notNull().default('commission_on_net'),
    vatRate: numeric('vat_rate', { precision: 6, scale: 4 }).notNull().default('0.05'),
    payoutCycleDays: integer('payout_cycle_days').notNull().default(14),
    deliveryFeeBearer: feeBearerEnum('delivery_fee_bearer').notNull().default('customer'),
    currency: char('currency', { length: 3 }).notNull().default('AED'),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('baa_lookup_idx').on(table.branchId, table.aggregatorId, table.effectiveFrom),
  ],
);

// ---------------------------------------------------------------------------
// Raw layer
// ---------------------------------------------------------------------------

export const sourceDocuments = pgTable('source_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  aggregatorId: uuid('aggregator_id').references(() => aggregators.id),
  kind: sourceDocumentKindEnum('kind').notNull().default('unknown'),
  storagePath: text('storage_path').notNull(),
  originalFilename: text('original_filename'),
  receivedVia: receivedViaEnum('received_via').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  periodStart: date('period_start', { mode: 'string' }),
  periodEnd: date('period_end', { mode: 'string' }),
  checksum: text('checksum').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }),
  parserKey: text('parser_key'),
  parserVersion: text('parser_version'),
  parseMethod: parseMethodEnum('parse_method'),
  headerFingerprint: text('header_fingerprint'),
  parseStatus: parseStatusEnum('parse_status').notNull().default('pending'),
  parseError: text('parse_error'),
  parsedAt: timestamp('parsed_at', { withTimezone: true }),
  rowCount: integer('row_count').notNull().default(0),
  auditToken: text('audit_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sourceRows = pgTable(
  'source_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    raw: jsonb('raw').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('source_rows_unique').on(table.sourceDocumentId, table.rowIndex)],
);

// ---------------------------------------------------------------------------
// Canonical layer
// ---------------------------------------------------------------------------

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    aggregatorId: uuid('aggregator_id').notNull().references(() => aggregators.id),
    externalOrderId: text('external_order_id').notNull(),
    orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    grossAmountMinor: bigint('gross_amount_minor', { mode: 'number' }).notNull(),
    itemTotalMinor: bigint('item_total_minor', { mode: 'number' }).notNull(),
    deliveryFeeMinor: bigint('delivery_fee_minor', { mode: 'number' }).notNull().default(0),
    vatAmountMinor: bigint('vat_amount_minor', { mode: 'number' }).notNull().default(0),
    discountTotalMinor: bigint('discount_total_minor', { mode: 'number' }).notNull().default(0),
    promoFunding: jsonb('promo_funding').notNull().default([]),
    status: orderStatusEnum('status').notNull().default('unknown'),
    currency: char('currency', { length: 3 }).notNull(),
    sourceRowId: uuid('source_row_id').notNull().references(() => sourceRows.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('orders_unique').on(
      table.orgId,
      table.branchId,
      table.aggregatorId,
      table.externalOrderId,
    ),
    index('orders_period_idx').on(table.branchId, table.aggregatorId, table.localDate),
  ],
);

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    aggregatorId: uuid('aggregator_id').notNull().references(() => aggregators.id),
    externalPayoutId: text('external_payout_id').notNull(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    grossMinor: bigint('gross_minor', { mode: 'number' }).notNull().default(0),
    deductionsMinor: bigint('deductions_minor', { mode: 'number' }).notNull().default(0),
    netMinor: bigint('net_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull(),
    paidOn: date('paid_on', { mode: 'string' }),
    sourceDocumentId: uuid('source_document_id').notNull().references(() => sourceDocuments.id),
    sourceRowId: uuid('source_row_id').notNull().references(() => sourceRows.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('payouts_unique').on(
      table.orgId,
      table.branchId,
      table.aggregatorId,
      table.externalPayoutId,
    ),
  ],
);

export const payoutLines = pgTable(
  'payout_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    payoutId: uuid('payout_id').notNull().references(() => payouts.id, { onDelete: 'cascade' }),
    externalOrderId: text('external_order_id'),
    lineType: payoutLineTypeEnum('line_type').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    description: text('description'),
    reference: text('reference'),
    sourceRowId: uuid('source_row_id').notNull().references(() => sourceRows.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('payout_lines_payout_idx').on(table.payoutId)],
);

// ---------------------------------------------------------------------------
// Derived layer
// ---------------------------------------------------------------------------

export const causeCodes = pgTable('cause_codes', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  labelAr: text('label_ar'),
  description: text('description').notNull(),
  disputeTemplateKey: text('dispute_template_key'),
  recoverability: recoverabilityEnum('recoverability').notNull(),
  countsTowardsRecovery: boolean('counts_towards_recovery').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reconRuns = pgTable('recon_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  aggregatorId: uuid('aggregator_id').notNull().references(() => aggregators.id),
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  periodEnd: date('period_end', { mode: 'string' }).notNull(),
  engineVersion: text('engine_version').notNull(),
  ruleSetVersion: text('rule_set_version').notNull(),
  runKey: text('run_key').notNull(),
  materialityThresholdMinor: bigint('materiality_threshold_minor', { mode: 'number' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  status: reconRunStatusEnum('status').notNull().default('running'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  orderCount: integer('order_count').notNull().default(0),
  payoutLineCount: integer('payout_line_count').notNull().default(0),
  varianceCount: integer('variance_count').notNull().default(0),
  unmatchedLineCount: integer('unmatched_line_count').notNull().default(0),
  recoveryTotalMinor: bigint('recovery_total_minor', { mode: 'number' }).notNull().default(0),
  warnings: jsonb('warnings').notNull().default([]),
  error: text('error'),
  triggeredBy: uuid('triggered_by').references(() => appUsers.id, { onDelete: 'set null' }),
});

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  reconRunId: uuid('recon_run_id').notNull().references(() => reconRuns.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  payoutLineIds: uuid('payout_line_ids').array().notNull(),
  method: matchMethodEnum('method').notNull(),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
});

export const unmatchedLines = pgTable(
  'unmatched_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    reconRunId: uuid('recon_run_id')
      .notNull()
      .references(() => reconRuns.id, { onDelete: 'cascade' }),
    payoutLineId: uuid('payout_line_id')
      .notNull()
      .references(() => payoutLines.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => appUsers.id, { onDelete: 'set null' }),
  },
  (table) => [unique('unmatched_lines_unique').on(table.reconRunId, table.payoutLineId)],
);

export const variances = pgTable('variances', {
  id: uuid('id').primaryKey(),
  reconRunId: uuid('recon_run_id').notNull().references(() => reconRuns.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  aggregatorId: uuid('aggregator_id').notNull().references(() => aggregators.id),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  causeCode: text('cause_code').notNull().references(() => causeCodes.code),
  expectedMinor: bigint('expected_minor', { mode: 'number' }).notNull(),
  actualMinor: bigint('actual_minor', { mode: 'number' }).notNull(),
  deltaMinor: bigint('delta_minor', { mode: 'number' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
  evidence: jsonb('evidence').notNull(),
  status: varianceStatusEnum('status').notNull().default('open'),
  dismissedReason: text('dismissed_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    aggregatorId: uuid('aggregator_id').notNull().references(() => aggregators.id),
    reference: text('reference').notNull(),
    varianceIds: uuid('variance_ids').array().notNull(),
    claimedMinor: bigint('claimed_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull(),
    packDocumentPath: text('pack_document_path'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    externalReference: text('external_reference'),
    outcome: disputeOutcomeEnum('outcome').notNull().default('pending'),
    recoveredMinor: bigint('recovered_minor', { mode: 'number' }).notNull().default(0),
    outcomeRecordedAt: timestamp('outcome_recorded_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('disputes_reference_unique').on(table.orgId, table.reference)],
);

// ---------------------------------------------------------------------------
// Ingestion, billing, analytics, audit
// ---------------------------------------------------------------------------

export const ingestionAddresses = pgTable(
  'ingestion_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    aggregatorId: uuid('aggregator_id').notNull().references(() => aggregators.id),
    localPart: text('local_part').notNull().unique(),
    isActive: boolean('is_active').notNull().default(true),
    lastReceivedAt: timestamp('last_received_at', { withTimezone: true }),
    receivedCount: integer('received_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('ingestion_addresses_unique').on(table.branchId, table.aggregatorId)],
);

export const parserFingerprints = pgTable(
  'parser_fingerprints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregatorId: uuid('aggregator_id')
      .notNull()
      .references(() => aggregators.id, { onDelete: 'cascade' }),
    parserKey: text('parser_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    headerSample: jsonb('header_sample').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    seenCount: integer('seen_count').notNull().default(1),
    isKnown: boolean('is_known').notNull().default(true),
  },
  (table) => [unique('parser_fingerprints_unique').on(table.aggregatorId, table.fingerprint)],
);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().unique().references(() => organisations.id, { onDelete: 'cascade' }),
  provider: paymentProviderEnum('provider').notNull().default('stripe'),
  planCode: planCodeEnum('plan_code').notNull().default('standard'),
  billingInterval: text('billing_interval').notNull().default('monthly'),
  status: subscriptionStatusEnum('status').notNull().default('trialing'),
  pricePerBranchMinor: bigint('price_per_branch_minor', { mode: 'number' }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('GBP'),
  branchLimit: integer('branch_limit'),
  externalCustomerId: text('external_customer_id'),
  externalSubscriptionId: text('external_subscription_id'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const analyticsEvents = pgTable('analytics_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  properties: jsonb('properties').notNull().default({}),
  anonymousId: text('anonymous_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  actorType: text('actor_type').notNull().default('user'),
  action: text('action').notNull(),
  targetTable: text('target_table').notNull(),
  targetId: text('target_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  checksum: text('checksum').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});
