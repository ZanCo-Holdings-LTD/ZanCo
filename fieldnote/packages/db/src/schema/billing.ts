import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './orgs.js';
import { reports } from './reports.js';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' })
      .unique(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    planId: text('plan_id').notNull().default('solo_monthly'),
    /** Paid seats. Enforced when inviting a member. */
    seats: integer('seats').notNull().default(1),
    status: text('status').notNull().default('trialing'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAt: timestamp('cancel_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    customerIdx: index('subscriptions_stripe_customer_idx').on(table.stripeCustomerId),
  }),
);

/**
 * Inference spend per report.
 *
 * Written by the worker as each stage completes. Instrumented from the first AI
 * milestone because long reports from heavy users are exactly what inverts unit
 * margin, and the alert has to fire before that shows up in a monthly invoice.
 */
export const reportCosts = pgTable(
  'report_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' })
      .unique(),
    transcriptionUsd: numeric('transcription_usd', { precision: 10, scale: 6 })
      .notNull()
      .default('0'),
    structuringUsd: numeric('structuring_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    audioMs: integer('audio_ms').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ orgIdx: index('report_costs_org_idx').on(table.orgId) }),
);

export type Subscription = typeof subscriptions.$inferSelect;
export type ReportCost = typeof reportCosts.$inferSelect;
