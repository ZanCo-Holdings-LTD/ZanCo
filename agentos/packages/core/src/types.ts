/**
 * Domain vocabulary shared by the database, the worker and the web app.
 *
 * These unions are duplicated as Postgres enums in the migrations. The two are
 * kept in step by a test (`packages/db/tests/enums.pg.test.ts`) that reads the
 * enum labels out of the live database and compares them to the arrays here, so
 * adding a value in one place and forgetting the other fails CI.
 */

export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'pro', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Ordered most- to least-privileged. Used by `hasAtLeastRole`. */
const ROLE_RANK: Record<MemberRole, number> = {
  owner: 50,
  admin: 40,
  manager: 30,
  pro: 20,
  viewer: 10,
};

export function hasAtLeastRole(actual: MemberRole, required: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * Jurisdictions we hold renewal rules for. Free-form `free_zone` sits alongside
 * this — a Meydan licence and an IFZA licence are both `AE-DU` but renew on
 * different ladders, which is exactly why rules are data.
 */
export const JURISDICTIONS = [
  'AE-DU', // Dubai
  'AE-AZ', // Abu Dhabi
  'AE-SH', // Sharjah
  'AE-RK', // Ras Al Khaimah
  'AE-AJ', // Ajman
  'AE-FU', // Fujairah
  'AE-UQ', // Umm Al Quwain
  'AE-FED', // UAE federal (MOHRE, ICP, GDRFA-level documents)
  'SA', // Saudi Arabia
  'OTHER',
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  'AE-DU': 'Dubai',
  'AE-AZ': 'Abu Dhabi',
  'AE-SH': 'Sharjah',
  'AE-RK': 'Ras Al Khaimah',
  'AE-AJ': 'Ajman',
  'AE-FU': 'Fujairah',
  'AE-UQ': 'Umm Al Quwain',
  'AE-FED': 'UAE (federal)',
  SA: 'Saudi Arabia',
  OTHER: 'Other',
};

export const ENTITY_TYPES = [
  'free_zone_llc',
  'mainland_llc',
  'branch',
  'sole_establishment',
  'offshore',
  'foundation',
  'representative_office',
  'other',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_STATUSES = ['active', 'onboarding', 'dormant', 'terminated'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

/**
 * Every renewable thing in the system. `source_type` on a renewal and
 * `doc_type` on a rule both draw from this list, which is what lets the engine
 * resolve a rule for any renewable record without a per-table special case.
 */
export const RENEWABLE_DOC_TYPES = [
  'trade_licence',
  'commercial_registration',
  'establishment_card',
  'immigration_card',
  'chamber_of_commerce',
  'municipality_permit',
  'ejari_lease',
  'office_lease',
  'visa_quota',
  'passport',
  'residence_visa',
  'iqama',
  'emirates_id',
  'labour_card',
  'medical_insurance',
  'work_permit',
  'other',
] as const;
export type RenewableDocType = (typeof RENEWABLE_DOC_TYPES)[number];

/** Renewables that hang off an entity rather than a person. */
export const ENTITY_DOC_TYPES = [
  'trade_licence',
  'commercial_registration',
  'establishment_card',
  'immigration_card',
  'chamber_of_commerce',
  'municipality_permit',
  'ejari_lease',
  'office_lease',
  'visa_quota',
] as const satisfies readonly RenewableDocType[];

/** Renewables that hang off a person. */
export const PERSON_DOC_TYPES = [
  'passport',
  'residence_visa',
  'iqama',
  'emirates_id',
  'labour_card',
  'medical_insurance',
  'work_permit',
] as const satisfies readonly RenewableDocType[];
export type PersonDocType = (typeof PERSON_DOC_TYPES)[number];

export function isPersonDocType(value: RenewableDocType): value is PersonDocType {
  return (PERSON_DOC_TYPES as readonly RenewableDocType[]).includes(value);
}

export const LICENCE_TYPES = [
  'commercial',
  'professional',
  'industrial',
  'tourism',
  'e_commerce',
  'freelance',
  'general_trading',
  'other',
] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

export const ESTABLISHMENT_RECORD_TYPES = [
  'establishment_card',
  'immigration_card',
  'labour_establishment',
  'chamber_of_commerce',
  'vat_registration',
  'corporate_tax_registration',
  'gosi_registration',
  'other',
] as const;
export type EstablishmentRecordType = (typeof ESTABLISHMENT_RECORD_TYPES)[number];

/**
 * Lifecycle of a single document record. `expiring` is derived on read from the
 * governing rule's lead time, never stored — storing it would mean a nightly
 * job could leave it stale and a stale status here means a missed renewal.
 */
export const DOC_STATUSES = ['active', 'expiring', 'expired', 'cancelled', 'superseded'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const RENEWAL_STATUSES = [
  'open',
  'in_progress',
  'submitted',
  'blocked',
  'completed',
  'cancelled',
] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export const OPEN_RENEWAL_STATUSES = [
  'open',
  'in_progress',
  'submitted',
  'blocked',
] as const satisfies readonly RenewalStatus[];

export function isRenewalOpen(status: RenewalStatus): boolean {
  return (OPEN_RENEWAL_STATUSES as readonly RenewalStatus[]).includes(status);
}

export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'waiting_client',
  'waiting_authority',
  'blocked',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskOpen(status: TaskStatus): boolean {
  return status !== 'done' && status !== 'cancelled';
}

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void', 'overdue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['email', 'whatsapp', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'skipped',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Who a reminder goes to. Escalation walks up this list. */
export const NOTIFICATION_AUDIENCES = [
  'assigned_pro',
  'account_manager',
  'org_owner',
  'client_contact',
] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

/**
 * Confirmation state of an extracted field. Nothing extracted is ever
 * authoritative — a value only becomes a renewal date once a human has moved it
 * to `confirmed`.
 */
export const EXTRACTION_REVIEW_STATUSES = [
  'pending_review',
  'confirmed',
  'corrected',
  'rejected',
  'manual_entry_required',
] as const;
export type ExtractionReviewStatus = (typeof EXTRACTION_REVIEW_STATUSES)[number];

export const CURRENCIES = ['AED', 'SAR', 'GBP', 'USD', 'EUR', 'OMR', 'QAR', 'BHD', 'KWD'] as const;
export type Currency = (typeof CURRENCIES)[number];
