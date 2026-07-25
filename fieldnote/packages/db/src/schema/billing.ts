import { bigint, char, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
    /** Per-seat price in minor units of `currency`: pence for GBP, fils for AED. */
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('GBP'),
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
    /**
     * Millionths of a USD, integer only. A per-report inference cost is a
     * fraction of a cent, and no money column in this schema is a float.
     */
    transcriptionMicrosUsd: bigint('transcription_micros_usd', { mode: 'number' })
      .notNull()
      .default(0),
    structuringMicrosUsd: bigint('structuring_micros_usd', { mode: 'number' }).notNull().default(0),
    costCurrency: char('cost_currency', { length: 3 }).notNull().default('USD'),
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
