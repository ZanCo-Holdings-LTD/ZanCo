import { pgEnum } from 'drizzle-orm/pg-core';
import {
  FIELD_TYPES,
  JOB_KINDS,
  JOB_STATES,
  ORG_ROLES,
  REPORT_STATUSES,
  UPLOAD_STATES,
  VERTICALS,
} from '@fieldnote/shared';

/**
 * Postgres enums mirror the shared constants exactly. Adding a value means
 * changing the constant and generating a migration — the type system will not
 * let the two drift.
 */
export const orgRoleEnum = pgEnum('org_role', ORG_ROLES);
export const reportStatusEnum = pgEnum('report_status', REPORT_STATUSES);
export const uploadStateEnum = pgEnum('upload_state', UPLOAD_STATES);
export const fieldTypeEnum = pgEnum('field_type', FIELD_TYPES);
export const verticalEnum = pgEnum('vertical', VERTICALS);
export const jobStateEnum = pgEnum('job_state', JOB_STATES);
export const jobKindEnum = pgEnum('job_kind', JOB_KINDS);
