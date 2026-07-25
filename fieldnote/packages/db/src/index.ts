/**
 * Public surface.
 *
 * Schema and repositories are exported as namespaces rather than flattened.
 * Both define `reports`, `captures`, `jobs`, `organisations` and `templates` —
 * one as a table, one as a set of functions — so a flat re-export is ambiguous.
 * Callers say `schema.reports` or `repositories.reports` and mean it.
 */
export * from './client.js';
export * as schema from './schema/index.js';
export * as repositories from './repositories/index.js';

// Row types are unambiguous and convenient to import directly.
export type { Organisation, NewOrganisation, OrgMember, Profile } from './schema/orgs.js';
export type { Template, TemplateSection, TemplateField } from './schema/templates.js';
export type { Report, NewReport } from './schema/reports.js';
export type { Capture, NewCapture, MediaAsset } from './schema/captures.js';
export type { ReportValue, NewReportValue } from './schema/values.js';
export type { ReportVersion, Delivery } from './schema/delivery.js';
export type { PhraseExampleRow, NewPhraseExample } from './schema/learning.js';
export type { Job, NewJob } from './schema/jobs.js';
export type { ReconRun, NewReconRun } from './schema/runs.js';
export type { Subscription, ReportCost } from './schema/billing.js';
export type { AuditLogEntry, NewAuditLogEntry } from './schema/audit.js';
