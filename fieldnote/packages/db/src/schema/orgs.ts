import { relations } from 'drizzle-orm';
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { orgRoleEnum } from './enums.js';

/**
 * The tenant boundary. Every row in the product hangs off an organisation, and
 * every RLS policy resolves back to a membership row here.
 */
export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    // References auth.users(id), which Drizzle does not model. The FK is added
    // in the migration so account deletion cascades correctly.
    userId: uuid('user_id').notNull(),
    role: orgRoleEnum('role').notNull().default('member'),
    invitedEmail: text('invited_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.orgId, table.userId] }),
    userIdx: index('org_members_user_idx').on(table.userId),
  }),
);

/**
 * Per-user branding. Letterhead, logo and signature are what make the PDF
 * indistinguishable from the firm's own template.
 */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    fullName: text('full_name'),
    companyName: text('company_name'),
    logoPath: text('logo_path'),
    letterheadPath: text('letterhead_path'),
    signaturePath: text('signature_path'),
    professionalBody: text('professional_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ orgIdx: index('profiles_org_idx').on(table.orgId) }),
);

export const organisationsRelations = relations(organisations, ({ many }) => ({
  members: many(orgMembers),
  profiles: many(profiles),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  organisation: one(organisations, {
    fields: [orgMembers.orgId],
    references: [organisations.id],
  }),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  organisation: one(organisations, {
    fields: [profiles.orgId],
    references: [organisations.id],
  }),
}));

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type OrgMember = typeof orgMembers.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
