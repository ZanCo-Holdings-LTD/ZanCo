/**
 * Drizzle schema.
 *
 * The migrations in `packages/db/migrations` are the source of truth for the
 * database — see `docs/adr/0002-hand-written-sql-migrations.md`. This file is
 * the typed view of that schema used to build queries, and it is kept honest by
 * `packages/db/tests/schema-parity.pg.test.ts`, which compares every table and
 * column here against the live catalogue.
 *
 * Note `date({ mode: 'string' })` throughout. Expiry dates are calendar dates,
 * not instants, and reading them as JS `Date` objects is how a licence that
 * expires on the 14th starts displaying as the 13th to a user in a negative
 * offset. `PlainDate` from `@agentos/core` is the type on the other side.
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
  ENTITY_STATUSES,
  ENTITY_TYPES,
  ESTABLISHMENT_RECORD_TYPES,
  EXTRACTION_REVIEW_STATUSES,
  INVOICE_STATUSES,
  JURISDICTIONS,
  LICENCE_TYPES,
  MEMBER_ROLES,
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  RENEWABLE_DOC_TYPES,
  RENEWAL_STATUSES,
  TASK_STATUSES,
  DOC_STATUSES,
} from '@agentos/core';
import { PAYMENT_PROVIDERS, PLAN_CODES, SUBSCRIPTION_STATUSES } from '@agentos/core';
import { RENEWABLE_SOURCE_TYPES } from '@agentos/core';

// ---------------------------------------------------------------------------
// Enums — the label lists come from @agentos/core so the two cannot drift.
// ---------------------------------------------------------------------------

export const memberRoleEnum = pgEnum('member_role', MEMBER_ROLES);
export const jurisdictionEnum = pgEnum('jurisdiction', JURISDICTIONS);
export const entityTypeEnum = pgEnum('entity_type', ENTITY_TYPES);
export const entityStatusEnum = pgEnum('entity_status', ENTITY_STATUSES);
export const renewableDocTypeEnum = pgEnum('renewable_doc_type', RENEWABLE_DOC_TYPES);
export const licenceTypeEnum = pgEnum('licence_type', LICENCE_TYPES);
export const establishmentRecordTypeEnum = pgEnum(
  'establishment_record_type',
  ESTABLISHMENT_RECORD_TYPES,
);
export const docStatusEnum = pgEnum('doc_status', DOC_STATUSES);
export const renewalStatusEnum = pgEnum('renewal_status', RENEWAL_STATUSES);
export const renewalSourceTypeEnum = pgEnum('renewal_source_type', RENEWABLE_SOURCE_TYPES);
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationStatusEnum = pgEnum('notification_status', NOTIFICATION_STATUSES);
export const notificationAudienceEnum = pgEnum('notification_audience', NOTIFICATION_AUDIENCES);
export const extractionReviewStatusEnum = pgEnum(
  'extraction_review_status',
  EXTRACTION_REVIEW_STATUSES,
);
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const paymentProviderEnum = pgEnum('payment_provider', PAYMENT_PROVIDERS);
export const planCodeEnum = pgEnum('plan_code', PLAN_CODES);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const appUsers = pgTable('app_users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  country: char('country', { length: 2 }).notNull().default('AE'),
  defaultCurrency: char('default_currency', { length: 3 }).notNull().default('AED'),
  defaultLocale: text('default_locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('Asia/Dubai'),
  branding: jsonb('branding').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    index('org_members_user_idx').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Client register
// ---------------------------------------------------------------------------

export const clientEntities = pgTable('client_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  jurisdiction: jurisdictionEnum('jurisdiction').notNull().default('OTHER'),
  freeZone: text('free_zone'),
  entityType: entityTypeEnum('entity_type').notNull().default('other'),
  incorporationDate: date('incorporation_date', { mode: 'string' }),
  status: entityStatusEnum('status').notNull().default('active'),
  primaryContactName: text('primary_contact_name'),
  primaryContactEmail: text('primary_contact_email'),
  primaryContactPhone: text('primary_contact_phone'),
  preferredLocale: text('preferred_locale').notNull().default('en'),
  accountManagerId: uuid('account_manager_id').references(() => appUsers.id, {
    onDelete: 'set null',
  }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').references(() => clientEntities.id, { onDelete: 'cascade' }),
  personId: uuid('person_id'),
  storagePath: text('storage_path').notNull(),
  docType: renewableDocTypeEnum('doc_type'),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  checksum: text('checksum'),
  uploadedBy: uuid('uploaded_by').references(() => appUsers.id, { onDelete: 'set null' }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  extracted: jsonb('extracted'),
  extractionConfidence: numeric('extraction_confidence', { precision: 4, scale: 3 }),
  modelVersion: text('model_version'),
  promptVersion: text('prompt_version'),
  reviewStatus: extractionReviewStatusEnum('review_status'),
  reviewedBy: uuid('reviewed_by').references(() => appUsers.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const licences = pgTable('licences', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => clientEntities.id, { onDelete: 'cascade' }),
  licenceType: licenceTypeEnum('licence_type').notNull().default('other'),
  numberEncrypted: text('number_encrypted').notNull(),
  numberHash: text('number_hash').notNull(),
  numberLast4: text('number_last4'),
  issuingAuthority: text('issuing_authority'),
  issuedOn: date('issued_on', { mode: 'string' }),
  expiresOn: date('expires_on', { mode: 'string' }).notNull(),
  status: docStatusEnum('status').notNull().default('active'),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const establishmentRecords = pgTable('establishment_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => clientEntities.id, { onDelete: 'cascade' }),
  recordType: establishmentRecordTypeEnum('record_type').notNull(),
  numberEncrypted: text('number_encrypted').notNull(),
  numberHash: text('number_hash').notNull(),
  numberLast4: text('number_last4'),
  issuingAuthority: text('issuing_authority'),
  issuedOn: date('issued_on', { mode: 'string' }),
  expiresOn: date('expires_on', { mode: 'string' }).notNull(),
  status: docStatusEnum('status').notNull().default('active'),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const visaQuotas = pgTable('visa_quotas', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => clientEntities.id, { onDelete: 'cascade' }),
  totalQuota: integer('total_quota').notNull().default(0),
  usedQuota: integer('used_quota').notNull().default(0),
  asOf: date('as_of', { mode: 'string' }).notNull(),
  expiresOn: date('expires_on', { mode: 'string' }),
  status: docStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const persons = pgTable('persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => clientEntities.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  role: text('role'),
  nationality: text('nationality'),
  email: text('email'),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const personDocuments = pgTable('person_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  personId: uuid('person_id')
    .notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => clientEntities.id, { onDelete: 'cascade' }),
  docType: renewableDocTypeEnum('doc_type').notNull(),
  numberEncrypted: text('number_encrypted').notNull(),
  numberHash: text('number_hash').notNull(),
  numberLast4: text('number_last4'),
  issuingAuthority: text('issuing_authority'),
  issuedOn: date('issued_on', { mode: 'string' }),
  expiresOn: date('expires_on', { mode: 'string' }).notNull(),
  status: docStatusEnum('status').notNull().default('active'),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Renewal engine
// ---------------------------------------------------------------------------

export const renewalRules = pgTable('renewal_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  jurisdiction: jurisdictionEnum('jurisdiction'),
  freeZone: text('free_zone'),
  docType: renewableDocTypeEnum('doc_type').notNull(),
  leadTimeDays: integer('lead_time_days').notNull(),
  escalationSchedule: jsonb('escalation_schedule').notNull(),
  version: integer('version').notNull().default(1),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const renewals = pgTable(
  'renewals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => clientEntities.id, { onDelete: 'cascade' }),
    sourceType: renewalSourceTypeEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    docType: renewableDocTypeEnum('doc_type').notNull(),
    opensOn: date('opens_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    status: renewalStatusEnum('status').notNull().default('open'),
    assignedTo: uuid('assigned_to').references(() => appUsers.id, { onDelete: 'set null' }),
    completedOn: date('completed_on', { mode: 'string' }),
    ruleId: uuid('rule_id').references(() => renewalRules.id, { onDelete: 'set null' }),
    ruleVersion: integer('rule_version'),
    ruleSnapshot: jsonb('rule_snapshot').notNull(),
    lastClientContactAt: timestamp('last_client_contact_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('renewals_source_due_unique').on(
      table.orgId,
      table.sourceType,
      table.sourceId,
      table.dueOn,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Tasks, fees, invoicing
// ---------------------------------------------------------------------------

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => clientEntities.id, { onDelete: 'cascade' }),
  renewalId: uuid('renewal_id').references(() => renewals.id, { onDelete: 'set null' }),
  taskType: text('task_type').notNull(),
  title: text('title').notNull(),
  status: taskStatusEnum('status').notNull().default('todo'),
  assigneeId: uuid('assignee_id').references(() => appUsers.id, { onDelete: 'set null' }),
  dueOn: date('due_on', { mode: 'string' }),
  notes: text('notes'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => clientEntities.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }),
    dueOn: date('due_on', { mode: 'string' }),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('invoices_number_unique').on(table.orgId, table.number)],
);

export const feeLedger = pgTable('fee_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => clientEntities.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  paidOn: date('paid_on', { mode: 'string' }),
  receiptDocumentId: uuid('receipt_document_id').references(() => documents.id, {
    onDelete: 'set null',
  }),
  recharged: boolean('recharged').notNull().default(false),
  invoiceId: uuid('invoice_id'),
  category: text('category'),
  createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const timeLogs = pgTable('time_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => clientEntities.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => appUsers.id, { onDelete: 'set null' }),
  minutes: integer('minutes').notNull(),
  hourlyCostMinor: bigint('hourly_cost_minor', { mode: 'number' }).notNull().default(0),
  currency: char('currency', { length: 3 }).notNull(),
  loggedOn: date('logged_on', { mode: 'string' }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull().default('1'),
  unitAmountMinor: bigint('unit_amount_minor', { mode: 'number' }).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  feeLedgerId: uuid('fee_ledger_id').references(() => feeLedger.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Portal, notifications, audit, billing
// ---------------------------------------------------------------------------

export const clientPortalUsers = pgTable(
  'client_portal_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => clientEntities.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    fullName: text('full_name'),
    preferredLocale: text('preferred_locale').notNull().default('en'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('client_portal_users_unique').on(table.orgId, table.entityId, table.email)],
);

export const clientPortalSessions = pgTable('client_portal_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  portalUserId: uuid('portal_user_id')
    .notNull()
    .references(() => clientPortalUsers.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationLog = pgTable('notification_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').references(() => clientEntities.id, { onDelete: 'cascade' }),
  renewalId: uuid('renewal_id').references(() => renewals.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  channel: notificationChannelEnum('channel').notNull(),
  audience: notificationAudienceEnum('audience').notNull(),
  templateKey: text('template_key').notNull(),
  locale: text('locale').notNull().default('en'),
  recipient: text('recipient').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  status: notificationStatusEnum('status').notNull().default('queued'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  scheduledOn: date('scheduled_on', { mode: 'string' }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  error: text('error'),
  payload: jsonb('payload'),
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

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .unique()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  provider: paymentProviderEnum('provider').notNull().default('stripe'),
  planCode: planCodeEnum('plan_code').notNull().default('starter'),
  billingInterval: text('billing_interval').notNull().default('monthly'),
  status: subscriptionStatusEnum('status').notNull().default('trialing'),
  externalCustomerId: text('external_customer_id'),
  externalSubscriptionId: text('external_subscription_id'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  entityCountAtPeriodStart: integer('entity_count_at_period_start'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  status: text('status').notNull().default('preview'),
  totalRows: integer('total_rows').notNull().default(0),
  importedRows: integer('imported_rows').notNull().default(0),
  issues: jsonb('issues').notNull().default([]),
  createdBy: uuid('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});
