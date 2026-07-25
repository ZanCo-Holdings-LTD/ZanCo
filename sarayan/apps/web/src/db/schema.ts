/**
 * Sarayan's data model.
 *
 * Organisation → Entity → Holder → Record → Alert → RenewalTask, exactly as
 * sketched in the brief. Every tenant-scoped table carries `organisationId`
 * directly, even where it could be derived by joining upwards: multi-tenant
 * isolation should be one `where` clause that is impossible to forget, not a
 * three-table join that is easy to get wrong.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planTierEnum = pgEnum("plan_tier", ["trial", "starter", "business", "enterprise", "agency"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "manager", "viewer"]);
export const holderKindEnum = pgEnum("holder_kind", ["person", "vehicle", "asset", "entity"]);
export const recordStatusEnum = pgEnum("record_status", [
  "valid",
  "due_soon",
  "critical",
  "expired",
  "dormant",
]);
export const alertChannelEnum = pgEnum("alert_channel", ["in_app", "email", "whatsapp", "sms"]);
export const alertStatusEnum = pgEnum("alert_status", ["scheduled", "sent", "acknowledged", "failed", "cancelled"]);
export const renewalStatusEnum = pgEnum("renewal_status", [
  "not_started",
  "in_progress",
  "blocked",
  "submitted",
  "completed",
  "cancelled",
]);
export const extractionStatusEnum = pgEnum("extraction_status", ["pending", "confirmed", "rejected", "failed"]);
export const billingStatusEnum = pgEnum("billing_status", ["trialing", "active", "past_due", "invoiced", "cancelled"]);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // Null for SSO-only users; the auth layer treats it as "no password login".
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    phone: text("phone"),
    locale: text("locale").notNull().default("en"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(sql`lower(${table.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the cookie value. A database leak must not yield live sessions.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    country: text("country").notNull().default("AE"),
    locale: text("locale").notNull().default("en"),
    tier: planTierEnum("tier").notNull().default("trial"),
    billingStatus: billingStatusEnum("billing_status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** Agencies bill per client entity on top of the platform fee. */
    isAgency: boolean("is_agency").notNull().default(false),
    /**
     * Trust mitigation from the brief: the customer keeps the files, Sarayan
     * keeps only the metadata and the dates.
     */
    metadataOnlyMode: boolean("metadata_only_mode").notNull().default(false),
    /** Region the tenant's files are pinned to. Part of the residency position. */
    storageRegion: text("storage_region").notNull().default("me-central-1"),
    /** Per-tenant data encryption key, itself encrypted with the master key. */
    wrappedDataKey: text("wrapped_data_key"),
    /** Alert ladder overrides; null means the default 90/60/30/14/7/1 ladder. */
    alertLadder: jsonb("alert_ladder"),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("organisations_slug_unique").on(table.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organisationId, table.userId] }),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("viewer"),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    index("invitations_org_idx").on(table.organisationId),
  ],
);

/** A legal entity. Agencies hold many; a direct customer usually holds one. */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    nameAr: text("name_ar"),
    country: text("country").notNull().default("AE"),
    jurisdiction: text("jurisdiction"),
    registrationNumber: text("registration_number"),
    taxNumber: text("tax_number"),
    /** Agency tier: the client this entity belongs to, and their reference. */
    clientReference: text("client_reference"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("entities_org_idx").on(table.organisationId)],
);

/** A person, vehicle, asset, or the entity itself — whatever a record hangs off. */
export const holders = pgTable(
  "holders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    kind: holderKindEnum("kind").notNull().default("person"),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    reference: text("reference"),
    nationality: text("nationality"),
    department: text("department"),
    email: text("email"),
    phone: text("phone"),
    /** Vehicles: plate; assets: location or serial. */
    identifier: text("identifier"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("holders_org_idx").on(table.organisationId),
    index("holders_entity_idx").on(table.entityId),
  ],
);

// ---------------------------------------------------------------------------
// The taxonomy, seeded from src/content/taxonomy
// ---------------------------------------------------------------------------

export const documentTypes = pgTable(
  "document_types",
  {
    code: text("code").primaryKey(),
    country: text("country").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    category: text("category").notNull(),
    holderKind: holderKindEnum("holder_kind").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    aliases: jsonb("aliases").notNull().default(sql`'[]'::jsonb`),
    issuingAuthority: text("issuing_authority").notNull(),
    issuingAuthorityAr: text("issuing_authority_ar").notNull(),
    typicalValidityMonths: integer("typical_validity_months"),
    renewalLeadDays: integer("renewal_lead_days").notNull().default(30),
    typicalRenewalCost: numeric("typical_renewal_cost", { precision: 12, scale: 2 }),
    renewalCostCurrency: text("renewal_cost_currency"),
    penalties: jsonb("penalties").notNull().default(sql`'[]'::jsonb`),
    blocks: jsonb("blocks").notNull().default(sql`'[]'::jsonb`),
    requires: jsonb("requires").notNull().default(sql`'[]'::jsonb`),
    consequences: jsonb("consequences").notNull().default(sql`'[]'::jsonb`),
    fields: jsonb("fields").notNull().default(sql`'[]'::jsonb`),
    seoSlug: text("seo_slug"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("document_types_country_idx").on(table.country)],
);

/**
 * Learned renewal lead times.
 *
 * Statistics over completed renewal tasks, not a model. Below 50 observations
 * the hand-curated default in the taxonomy wins.
 */
export const leadTimeObservations = pgTable(
  "lead_time_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentTypeCode: text("document_type_code")
      .notNull()
      .references(() => documentTypes.code, { onDelete: "cascade" }),
    country: text("country").notNull(),
    /** Days from renewal task start to completion. */
    observedDays: integer("observed_days").notNull(),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    currency: text("currency"),
    /** Anonymised: no organisation id, so the aggregate can be shared safely. */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lead_time_type_idx").on(table.documentTypeCode)],
);

// ---------------------------------------------------------------------------
// Records — the thing the whole product exists to watch
// ---------------------------------------------------------------------------

export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    holderId: uuid("holder_id")
      .notNull()
      .references(() => holders.id, { onDelete: "cascade" }),
    documentTypeCode: text("document_type_code").references(() => documentTypes.code, {
      onDelete: "set null",
    }),
    /** Used when the customer tracks something outside the curated taxonomy. */
    customTypeName: text("custom_type_name"),
    documentNumber: text("document_number"),
    issuedOn: date("issued_on"),
    expiresOn: date("expires_on"),
    /** Documents with no expiry (birth certificates, degrees) still belong here. */
    noExpiry: boolean("no_expiry").notNull().default(false),
    issuingAuthority: text("issuing_authority"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    status: recordStatusEnum("status").notNull().default("valid"),
    notes: text("notes"),
    /** Extracted field values, kept for the audit trail and re-extraction diffs. */
    extractedFields: jsonb("extracted_fields"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("records_org_idx").on(table.organisationId),
    index("records_entity_idx").on(table.entityId),
    index("records_holder_idx").on(table.holderId),
    // The dashboard's core query: this org's records, soonest expiry first.
    index("records_org_expiry_idx").on(table.organisationId, table.expiresOn),
    index("records_status_idx").on(table.organisationId, table.status),
  ],
);

export const recordFiles = pgTable(
  "record_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** SHA-256 of the plaintext file, printed in evidence packs. */
    sha256: text("sha256").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("record_files_record_idx").on(table.recordId),
    index("record_files_org_idx").on(table.organisationId),
  ],
);

/** One row per model call, kept so corrections become an eval set. */
export const extractions = pgTable(
  "extractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    recordId: uuid("record_id").references(() => records.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").references(() => recordFiles.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),
    classifiedTypeCode: text("classified_type_code"),
    classificationConfidence: numeric("classification_confidence", { precision: 4, scale: 3 }),
    /** Raw per-field output with confidences, exactly as returned. */
    fields: jsonb("fields").notNull().default(sql`'[]'::jsonb`),
    /** Fields a human changed. This is the training signal. */
    corrections: jsonb("corrections").notNull().default(sql`'[]'::jsonb`),
    warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),
    status: extractionStatusEnum("status").notNull().default("pending"),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("extractions_org_idx").on(table.organisationId)],
);

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    /** Which rung of the ladder this is: 90, 60, 30, 14, 7, 1, -1, -7. */
    offsetDays: integer("offset_days").notNull(),
    dueOn: date("due_on").notNull(),
    channels: jsonb("channels").notNull().default(sql`'[]'::jsonb`),
    audience: jsonb("audience").notNull().default(sql`'[]'::jsonb`),
    escalateIfUnacknowledged: boolean("escalate_if_unacknowledged").notNull().default(false),
    status: alertStatusEnum("status").notNull().default("scheduled"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    escalationCount: integer("escalation_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Idempotent scheduling: one row per record per rung.
    uniqueIndex("alerts_record_offset_unique").on(table.recordId, table.offsetDays),
    // The scheduler's query: everything due today that has not been dealt with.
    index("alerts_due_idx").on(table.dueOn, table.status),
    index("alerts_org_idx").on(table.organisationId),
  ],
);

/** One row per message actually sent — the delivery and cost ledger. */
export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    channel: alertChannelEnum("channel").notNull(),
    recipient: text("recipient").notNull(),
    providerMessageId: text("provider_message_id"),
    succeeded: boolean("succeeded").notNull().default(false),
    error: text("error"),
    /** Metered per message, in the smallest currency unit, for WhatsApp margin control. */
    costMinorUnits: integer("cost_minor_units").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("alert_deliveries_org_idx").on(table.organisationId),
    index("alert_deliveries_alert_idx").on(table.alertId),
  ],
);

// ---------------------------------------------------------------------------
// Renewals
// ---------------------------------------------------------------------------

export const renewalTasks = pgTable(
  "renewal_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    status: renewalStatusEnum("status").notNull().default("not_started"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Actual cost, captured so the estimate improves over time. */
    cost: numeric("cost", { precision: 12, scale: 2 }),
    currency: text("currency"),
    startedOn: date("started_on"),
    targetOn: date("target_on"),
    completedOn: date("completed_on"),
    /** The expiry date the renewal produced, written back to the record. */
    newExpiryDate: date("new_expiry_date"),
    blockedReason: text("blocked_reason"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("renewal_tasks_org_idx").on(table.organisationId),
    index("renewal_tasks_record_idx").on(table.recordId),
    index("renewal_tasks_status_idx").on(table.organisationId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const evidencePacks = pgTable(
  "evidence_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    /** SHA-256 over the canonical payload — the public verification handle. */
    hash: text("hash").notNull(),
    scope: text("scope").notNull(),
    /** Canonical JSON the hash covers, kept so verification is a comparison. */
    canonicalPayload: text("canonical_payload").notNull(),
    recordCount: integer("record_count").notNull().default(0),
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    generatedBy: uuid("generated_by").references(() => users.id, { onDelete: "set null" }),
    generatedByName: text("generated_by_name").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Revoked packs still verify, but report as superseded. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("evidence_packs_hash_unique").on(table.hash),
    index("evidence_packs_org_idx").on(table.organisationId),
  ],
);

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 of the key. The plaintext is shown once, at creation. */
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("api_keys_hash_unique").on(table.keyHash),
    index("api_keys_org_idx").on(table.organisationId),
  ],
);

/** Manual invoice flow — not optional in the Gulf. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    tier: planTierEnum("tier").notNull(),
    amountMinorUnits: integer("amount_minor_units").notNull(),
    currency: text("currency").notNull().default("GBP"),
    periodMonths: integer("period_months").notNull().default(12),
    /** Gulf buyers routinely need a local VAT number on the invoice. */
    buyerVatNumber: text("buyer_vat_number"),
    buyerAddress: text("buyer_address"),
    issuedOn: date("issued_on").notNull(),
    dueOn: date("due_on").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invoices_reference_unique").on(table.reference),
    index("invoices_org_idx").on(table.organisationId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_org_idx").on(table.organisationId, table.createdAt),
    index("audit_log_subject_idx").on(table.subjectType, table.subjectId),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const organisationsRelations = relations(organisations, ({ many }) => ({
  memberships: many(memberships),
  entities: many(entities),
  records: many(records),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(sessions),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organisation: one(organisations, {
    fields: [memberships.organisationId],
    references: [organisations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [entities.organisationId],
    references: [organisations.id],
  }),
  holders: many(holders),
  records: many(records),
}));

export const holdersRelations = relations(holders, ({ one, many }) => ({
  entity: one(entities, { fields: [holders.entityId], references: [entities.id] }),
  records: many(records),
}));

export const recordsRelations = relations(records, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [records.organisationId],
    references: [organisations.id],
  }),
  entity: one(entities, { fields: [records.entityId], references: [entities.id] }),
  holder: one(holders, { fields: [records.holderId], references: [holders.id] }),
  documentType: one(documentTypes, {
    fields: [records.documentTypeCode],
    references: [documentTypes.code],
  }),
  owner: one(users, { fields: [records.ownerUserId], references: [users.id] }),
  files: many(recordFiles),
  alerts: many(alerts),
  renewalTasks: many(renewalTasks),
}));

export const alertsRelations = relations(alerts, ({ one, many }) => ({
  record: one(records, { fields: [alerts.recordId], references: [records.id] }),
  deliveries: many(alertDeliveries),
}));

export const renewalTasksRelations = relations(renewalTasks, ({ one }) => ({
  record: one(records, { fields: [renewalTasks.recordId], references: [records.id] }),
  assignee: one(users, { fields: [renewalTasks.assigneeUserId], references: [users.id] }),
}));

export const recordFilesRelations = relations(recordFiles, ({ one }) => ({
  record: one(records, { fields: [recordFiles.recordId], references: [records.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Organisation = typeof organisations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type Holder = typeof holders.$inferSelect;
export type DocumentTypeRow = typeof documentTypes.$inferSelect;
export type RecordRow = typeof records.$inferSelect;
export type RecordFile = typeof recordFiles.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type RenewalTask = typeof renewalTasks.$inferSelect;
export type EvidencePackRow = typeof evidencePacks.$inferSelect;
export type Extraction = typeof extractions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
export type PlanTier = (typeof planTierEnum.enumValues)[number];
export type RecordStatus = (typeof recordStatusEnum.enumValues)[number];
