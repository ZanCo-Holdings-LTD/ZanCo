import type { PlanId } from './pricing.js';

/**
 * Payment provider abstraction.
 *
 * Stripe covers the UK and UAE. Saudi effectively requires Mada, which Stripe
 * does not serve, so a GCC launch means Moyasar or Tap. Putting the interface
 * in from the start costs almost nothing; retrofitting it around a Stripe
 * object graph that has leaked into route handlers and webhooks is a rewrite.
 *
 * Money crosses this boundary as integer minor units plus an ISO currency code,
 * never as a float and never as a formatted string.
 */

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface CheckoutRequest {
  orgId: string;
  planId: PlanId;
  seats: number;
  unitAmount: Money;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Idempotency key so a double-clicked upgrade bills once. */
  idempotencyKey: string;
}

export interface CheckoutSession {
  providerSessionId: string;
  redirectUrl: string;
}

export interface SubscriptionSnapshot {
  providerCustomerId: string;
  providerSubscriptionId: string;
  planId: PlanId;
  seats: number;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  unitAmount: Money;
}

export interface WebhookEvent {
  id: string;
  type: string;
  subscription: SubscriptionSnapshot | null;
}

export interface PaymentProvider {
  readonly name: 'stripe' | 'moyasar' | 'tap';

  /** Currencies this provider can actually charge in. */
  readonly supportedCurrencies: readonly string[];

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;

  /** A URL where the customer manages their own card and invoices. */
  createBillingPortalSession(providerCustomerId: string, returnUrl: string): Promise<string>;

  /** Change seat count mid-period. Proration is the provider's business. */
  updateSeats(providerSubscriptionId: string, seats: number): Promise<SubscriptionSnapshot>;

  cancel(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<SubscriptionSnapshot>;

  /**
   * Verify and parse a webhook.
   *
   * Takes the raw body, not a parsed object: every provider signs the exact
   * bytes, and a re-serialised body will not verify. Returns null when the
   * signature does not check out — the caller must treat that as a 401 and not
   * as an unknown event type.
   */
  parseWebhook(rawBody: string, signature: string): Promise<WebhookEvent | null>;
}

/**
 * Pick a provider for an organisation.
 *
 * Country rather than currency: a Saudi customer paying in USD still needs
 * Mada at the checkout, and that is a market-access question, not a pricing
 * one.
 */
export function providerForCountry(country: string): PaymentProvider['name'] {
  switch (country.toUpperCase()) {
    case 'SA':
      return 'moyasar';
    case 'GB':
    case 'AE':
    case 'IE':
    default:
      return 'stripe';
  }
}

export function formatMoney(money: Money, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(money.amountMinor / 100);
}
