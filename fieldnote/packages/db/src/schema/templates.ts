import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { fieldTypeEnum, verticalEnum } from './enums.js';
import { organisations } from './orgs.js';

/**
 * The moat lives here.
 *
 * A template is a versioned, expert-authored description of a real report
 * format. `org_id IS NULL` means a system template shipped by us and readable
 * by every org; a non-null org_id is a team's customisation of one.
 *
 * Templates are never edited in place once a report references them — a new
 * version row is created instead, so a report rendered last year still renders
 * identically today.
 */
export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
    vertical: verticalEnum('vertical').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    isSystem: boolean('is_system').notNull().default(false),
    /** Per-vertical keyword boost list handed to the ASR pass. */
    asrKeywords: jsonb('asr_keywords').$type<string[]>().notNull().default([]),
    /** Handlebars template name used to render the PDF. */
    pdfTemplate: text('pdf_template').notNull().default('default'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('templates_org_idx').on(table.orgId),
    verticalIdx: index('templates_vertical_idx').on(table.vertical),
    versionUnique: unique('templates_name_version_unique').on(
      table.orgId,
      table.name,
      table.version,
    ),
  }),
);

export const templateSections = pgTable(
  'template_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    title: text('title').notNull(),
    orderIndex: integer('order_index').notNull(),
    /** Prose shown to the inspector on the capture screen and to the model. */
    guidance: text('guidance'),
  },
  (table) => ({
    templateIdx: index('template_sections_template_idx').on(table.templateId),
    keyUnique: unique('template_sections_key_unique').on(table.templateId, table.key),
  }),
);

export const templateFields = pgTable(
  'template_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => templateSections.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: fieldTypeEnum('type').notNull(),
    required: boolean('required').notNull().default(false),
    enumValues: jsonb('enum_values').$type<string[] | null>(),
    /**
     * Told to the model, not the user: how this value is usually phrased on
     * site. This is where domain expertise turns into extraction accuracy.
     */
    extractionHint: text('extraction_hint'),
    orderIndex: integer('order_index').notNull(),
  },
  (table) => ({
    sectionIdx: index('template_fields_section_idx').on(table.sectionId),
    keyUnique: unique('template_fields_key_unique').on(table.sectionId, table.key),
  }),
);

export const templatesRelations = relations(templates, ({ many, one }) => ({
  sections: many(templateSections),
  organisation: one(organisations, {
    fields: [templates.orgId],
    references: [organisations.id],
  }),
}));

export const templateSectionsRelations = relations(templateSections, ({ many, one }) => ({
  template: one(templates, {
    fields: [templateSections.templateId],
    references: [templates.id],
  }),
  fields: many(templateFields),
}));

export const templateFieldsRelations = relations(templateFields, ({ one }) => ({
  section: one(templateSections, {
    fields: [templateFields.sectionId],
    references: [templateSections.id],
  }),
}));

export type Template = typeof templates.$inferSelect;
export type TemplateSection = typeof templateSections.$inferSelect;
export type TemplateField = typeof templateFields.$inferSelect;
