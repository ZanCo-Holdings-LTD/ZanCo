/**
 * Pricing, tiered by managed entity count.
 *
 * The tier is derived from the count of active entities, not sold as a seat
 * count, because entities-under-management is the metric that predicts
 * everything and it should rise on its own as the firm's client base grows.
 * That is where net revenue retention above 115 percent comes from.
 *
 * A firm that crosses a tier boundary is *not* cut off. They are moved to the
 * higher tier at the next billing cycle and told. Blocking a firm from adding
 * the 101st client entity would be blocking the exact behaviour the pricing is
 * designed to encourage.
 */
import { money, type Money } from '../money.js';
import type { Currency } from '../types.js';

export const PLAN_CODES = ['starter', 'growth', 'scale'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface Plan {
  readonly code: PlanCode;
  readonly name: string;
  /** Inclusive upper bound on active entities. `null` on the top tier. */
  readonly maxEntities: number | null;
  readonly monthlyMinor: number;
  /** Annual is ten months — two months free for paying up front. */
  readonly annualMinor: number;
  readonly currency: Currency;
}

const GBP: Currency = 'GBP';

export const PLANS: readonly Plan[] = [
  {
    code: 'starter',
    name: 'Starter',
    maxEntities: 100,
    monthlyMinor: 24_900,
    annualMinor: 249_000,
    currency: GBP,
  },
  {
    code: 'growth',
    name: 'Growth',
    maxEntities: 300,
    monthlyMinor: 39_900,
    annualMinor: 399_000,
    currency: GBP,
  },
  {
    code: 'scale',
    name: 'Scale',
    maxEntities: null,
    monthlyMinor: 59_900,
    annualMinor: 599_000,
    currency: GBP,
  },
];

export const BILLING_INTERVALS = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

const BY_CODE = new Map(PLANS.map((plan) => [plan.code, plan]));

export function plan(code: PlanCode): Plan {
  const found = BY_CODE.get(code);
  if (!found) throw new Error(`Unknown plan code: ${code}`);
  return found;
}

/** The tier a given entity count lands in. */
export function planForEntityCount(entityCount: number): Plan {
  const tier = PLANS.find((candidate) => candidate.maxEntities !== null && entityCount <= candidate.maxEntities);
  return tier ?? PLANS[PLANS.length - 1]!;
}

export function planPrice(code: PlanCode, interval: BillingInterval): Money {
  const target = plan(code);
  return money(
    interval === 'annual' ? target.annualMinor : target.monthlyMinor,
    target.currency,
  );
}

/** Annual as a multiple of monthly — asserted by a test to stay at ten. */
export function annualMonthsEquivalent(code: PlanCode): number {
  const target = plan(code);
  return target.annualMinor / target.monthlyMinor;
}

export interface PlanPosition {
  readonly currentPlan: Plan;
  readonly requiredPlan: Plan;
  readonly entityCount: number;
  /** True when the firm has outgrown what they are paying for. */
  readonly overTier: boolean;
  /** Entities remaining before the next tier. `null` on the top tier. */
  readonly headroom: number | null;
}

export function planPosition(currentCode: PlanCode, entityCount: number): PlanPosition {
  const currentPlan = plan(currentCode);
  const requiredPlan = planForEntityCount(entityCount);
  return {
    currentPlan,
    requiredPlan,
    entityCount,
    overTier: currentPlan.maxEntities !== null && entityCount > currentPlan.maxEntities,
    headroom:
      currentPlan.maxEntities === null ? null : Math.max(0, currentPlan.maxEntities - entityCount),
  };
}

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Read access is never revoked for a lapsed subscription. A firm whose card
 * failed still needs to see which of their clients' licences expire this week —
 * locking them out of that would cause exactly the harm the product prevents.
 * What lapses is writing, importing and outbound reminders.
 */
export function subscriptionAllowsWrites(status: SubscriptionStatus): boolean {
  return status === 'trialing' || status === 'active' || status === 'past_due';
}

export function subscriptionAllowsReads(): boolean {
  return true;
}

/** Outbound client reminders stop on a cancelled or paused subscription. */
export function subscriptionAllowsOutbound(status: SubscriptionStatus): boolean {
  return status === 'trialing' || status === 'active' || status === 'past_due';
}

export const PAYMENT_PROVIDERS = ['stripe', 'moyasar', 'tap', 'manual'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Stripe for the UAE and everywhere else; Moyasar or Tap once there are Saudi
 * customers who want to pay in SAR through mada.
 */
export function defaultProviderForCountry(country: string): PaymentProvider {
  return country.toUpperCase() === 'SA' ? 'moyasar' : 'stripe';
}
