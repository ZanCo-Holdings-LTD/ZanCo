/**
 * Domain constants shared by web, worker and mobile.
 *
 * Anything that both a reviewer's browser and the worker need to agree on
 * lives here so the two can never drift.
 */

/** Report lifecycle. A report only ever moves forward through these. */
export const REPORT_STATUSES = ['draft', 'processing', 'needs_review', 'ready', 'sent'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Draft',
  processing: 'Processing',
  needs_review: 'Needs review',
  ready: 'Ready to send',
  sent: 'Sent',
};

/** Capture upload state, mirrored by the mobile local store. */
export const UPLOAD_STATES = ['pending', 'uploading', 'uploaded', 'failed'] as const;
export type UploadState = (typeof UPLOAD_STATES)[number];

/** Transcription/structuring job lifecycle in the Postgres-backed queue. */
export const JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const JOB_KINDS = [
  'transcribe_capture',
  'structure_report',
  'render_pdf',
  'deliver_report',
  'embed_phrase_example',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Field types a template author may use. */
export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'boolean',
  'enum',
  'date',
  'multi_enum',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Org member roles. `owner` is the billing contact; there is exactly one. */
export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ROLE_RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

export function roleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Verticals. Vertical one is a decision made before coding — see CLAUDE.md. */
export const VERTICALS = ['uk_damp_timber', 'uk_eicr', 'gcc_snagging'] as const;
export type Vertical = (typeof VERTICALS)[number];

export const VERTICAL_LABELS: Record<Vertical, string> = {
  uk_damp_timber: 'UK damp & timber survey',
  uk_eicr: 'UK domestic EICR',
  gcc_snagging: 'GCC snagging & handover',
};

/** Storage buckets. Private by default; access is via signed URL only. */
export const STORAGE_BUCKETS = {
  captures: 'captures',
  media: 'media',
  branding: 'branding',
  reports: 'reports',
} as const;

export const MAX_CAPTURE_BYTES = 512 * 1024 * 1024; // 40 min of AAC leaves headroom
export const MAX_PHOTO_BYTES = 32 * 1024 * 1024;
export const MAX_PHRASE_EXAMPLES_PER_FIELD = 8;

/** Free-trial length in days. Activation is measured inside the first 48h. */
export const TRIAL_DAYS = 14;
