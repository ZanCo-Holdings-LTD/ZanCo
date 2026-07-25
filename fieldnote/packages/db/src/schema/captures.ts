import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Transcript } from '@fieldnote/shared';
import { uploadStateEnum } from './enums.js';
import { organisations } from './orgs.js';
import { reports } from './reports.js';

/**
 * One audio recording from the phone.
 *
 * Two transcripts are stored: the on-device draft (shown to the inspector for
 * confidence while still on site) and the cloud pass (used for structuring).
 * Neither is ever discarded — the raw transcript is the provenance source and
 * the liability defence.
 */
export const captures = pgTable(
  'captures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    sectionKey: text('section_key'),
    localTranscript: text('local_transcript'),
    cloudTranscript: jsonb('cloud_transcript').$type<Transcript | null>(),
    asrProvider: text('asr_provider'),
    asrModel: text('asr_model'),
    uploadState: uploadStateEnum('upload_state').notNull().default('pending'),
    /** Set when the cloud pass completes; null while transcription is pending. */
    transcribedAt: timestamp('transcribed_at', { withTimezone: true }),
    /** Client-generated, so a retried upload cannot create a duplicate row. */
    clientId: text('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reportIdx: index('captures_report_idx').on(table.reportId),
    orgIdx: index('captures_org_idx').on(table.orgId),
    stateIdx: index('captures_upload_state_idx').on(table.uploadState),
  }),
);

/**
 * A photo attached at a point in the audio timeline. `captureOffsetMs` is what
 * lets the review workspace show a photo strip aligned to what was being said.
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    captureId: uuid('capture_id').references(() => captures.id, { onDelete: 'set null' }),
    sectionKey: text('section_key'),
    storagePath: text('storage_path').notNull(),
    caption: text('caption'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    captureOffsetMs: integer('capture_offset_ms'),
    exif: jsonb('exif').$type<Record<string, unknown> | null>(),
    orderIndex: integer('order_index').notNull().default(0),
    clientId: text('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reportIdx: index('media_assets_report_idx').on(table.reportId),
    sectionIdx: index('media_assets_report_section_idx').on(table.reportId, table.sectionKey),
    orgIdx: index('media_assets_org_idx').on(table.orgId),
  }),
);

export const capturesRelations = relations(captures, ({ one, many }) => ({
  report: one(reports, { fields: [captures.reportId], references: [reports.id] }),
  media: many(mediaAssets),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  report: one(reports, { fields: [mediaAssets.reportId], references: [reports.id] }),
  capture: one(captures, { fields: [mediaAssets.captureId], references: [captures.id] }),
}));

export type Capture = typeof captures.$inferSelect;
export type NewCapture = typeof captures.$inferInsert;
export type MediaAsset = typeof mediaAssets.$inferSelect;
