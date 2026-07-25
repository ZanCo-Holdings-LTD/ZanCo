/**
 * Payment providers behind one interface.
 *
 * Stripe for the UAE and everywhere else; Moyasar or Tap for Saudi, where mada
 * is the card network that matters and a Stripe-only checkout loses a
 * meaningful share of sign-ups. The interface exists from the start because
 * retrofitting a second provider onto Stripe-shaped code is a rewrite of the
 * billing flow rather than an addition to it.
 *
 * Pricing per the brief: £99 per branch per month, £79 above five branches,
 * annual at ten months, and a founding rate of £79 locked for the first thirty
 * branches. The founding rate is stored on the subscription row rather than
 * recomputed, because "locked" has to survive a future price change.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PLAN_CODES = ['standard', 'multi_branch', 'recovery_share'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const STANDARD_PRICE_MINOR = 9_900;
export const MULTI_BRANCH_PRICE_MINOR = 7_900;
export const FOUNDING_PRICE_MINOR = 7_900;
export const MULTI_BRANCH_THRESHOLD = 5;
export const ANNUAL_MONTHS = 10;
export const FOUNDING_BRANCH_CAP = 30;

/** Recovery-share alternative for operators who do not believe you yet. */
export const RECOVERY_SHARE_PCT = 0.15;
export const RECOVERY_SHARE_CAP_MINOR = 49_900;

export function pricePerBranchMinor(branchCount: number, isFounding: boolean): number {
  if (isFounding) return FOUNDING_PRICE_MINOR;
  return branchCount > MULTI_BRANCH_THRESHOLD ? MULTI_BRANCH_PRICE_MINOR : STANDARD_PRICE_MINOR;
}

export function monthlyTotalMinor(branchCount: number, isFounding: boolean): number {
  return pricePerBranchMinor(branchCount, isFounding) * branchCount;
}

export function annualTotalMinor(branchCount: number, isFounding: boolean): number {
  return pricePerBranchMinor(branchCount, isFounding) * branchCount * ANNUAL_MONTHS;
}

/**
 * The recovery-share alternative, capped.
 *
 * The cap is what makes this safe to offer: without it, a single large recovery
 * would produce an invoice that destroys the relationship it was meant to build.
 */
export function recoveryShareMinor(recoveredMinor: number): number {
  return Math.min(Math.round(recoveredMinor * RECOVERY_SHARE_PCT), RECOVERY_SHARE_CAP_MINOR);
}

export interface CheckoutRequest {
  readonly orgId: string;
  readonly branchCount: number;
  readonly interval: 'monthly' | 'annual';
  readonly isFounding: boolean;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly customerEmail: string;
}

export interface CheckoutSession {
  readonly url: string;
  readonly externalId: string;
}

export interface WebhookEvent {
  readonly type: string;
  readonly externalCustomerId: string | null;
  readonly externalSubscriptionId: string | null;
  readonly orgId: string | null;
  readonly status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused' | null;
  readonly currentPeriodEnd: Date | null;
}

export interface PaymentProvider {
  readonly name: 'stripe' | 'moyasar' | 'tap' | 'manual';
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
  parseWebhook(rawBody: string): WebhookEvent | null;
}

/**
 * Constant-time comparison of an HMAC signature.
 *
 * Shared by the providers, and by the inbound email webhook. A webhook endpoint
 * that leaks timing is a webhook endpoint an attacker can forge against, and
 * this one accepts financial documents.
 */
export function verifyHmacSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (signature === undefined || signature === '') return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = signature.replace(/^sha256=/, '').trim();

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * The provider used when no payment integration is configured.
 *
 * It refuses to create a checkout rather than pretending to. A deployment with
 * billing half-configured should fail visibly at the point of sale, not take a
 * customer to a broken page.
 */
export class ManualProvider implements PaymentProvider {
  readonly name = 'manual' as const;

  async createCheckout(): Promise<CheckoutSession> {
    throw new Error(
      'No payment provider is configured. Set STRIPE_SECRET_KEY (or MOYASAR_SECRET_KEY for ' +
        'Saudi) before enabling checkout.',
    );
  }

  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(): WebhookEvent | null {
    return null;
  }
}

/**
 * Which provider a country should use.
 *
 * Saudi customers pay with mada, which Moyasar and Tap support and Stripe does
 * not; everyone else goes to Stripe.
 */
export function providerForCountry(country: string): 'stripe' | 'moyasar' {
  return country.toUpperCase() === 'SA' ? 'moyasar' : 'stripe';
}
