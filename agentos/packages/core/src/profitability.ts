/**
 * Per-client profitability, and the metrics the business is steered by.
 *
 * The profitability calculation matters more than it looks. Service providers
 * front government fees on a client's behalf and then fail to recharge some of
 * them — the brief is blunt that they lose real money here and nobody tracks it
 * properly. So the number that leads is not margin, it is *unrecharged
 * disbursements*: money already out of the door with no invoice against it.
 */
import { daysBetween, type PlainDate } from './dates.js';
import { add, money, subtract, zero, type Money } from './money.js';
import type { Currency } from './types.js';

export interface FeeLedgerEntry {
  readonly id: string;
  readonly entityId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  /** True once the cost has been passed on to the client. */
  readonly recharged: boolean;
  readonly invoiceId: string | null;
  readonly paidOn: PlainDate | null;
}

export interface InvoiceLineSummary {
  readonly entityId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly issuedOn: PlainDate;
}

export interface TimeLogEntry {
  readonly entityId: string;
  readonly minutes: number;
  /** Loaded cost of the person's time, per hour, in minor units. */
  readonly hourlyCostMinor: number;
  readonly currency: Currency;
}

export interface EntityProfitability {
  readonly entityId: string;
  readonly currency: Currency;
  /** What the firm invoiced, service fees and recharges together. */
  readonly revenue: Money;
  /** Government fees paid on the client's behalf. */
  readonly disbursements: Money;
  /** Disbursements that have been passed on. */
  readonly recharged: Money;
  /** Paid out and never recharged — the number that leads. */
  readonly unrecharged: Money;
  readonly timeCost: Money;
  /** revenue − disbursements − timeCost. */
  readonly netMinor: number;
  readonly net: Money;
  /** Net as a fraction of revenue. `null` when there is no revenue to divide by. */
  readonly marginPct: number | null;
  readonly loggedMinutes: number;
}

/**
 * Everything is computed in one currency. Mixed-currency ledgers are a real
 * case — a Dubai firm with a Riyadh client — but converting silently at a rate
 * nobody agreed is worse than making the caller split the report, so entries in
 * other currencies are returned as `skipped` rather than folded in at a guess.
 */
export interface ProfitabilityInput {
  readonly entityId: string;
  readonly currency: Currency;
  readonly fees: readonly FeeLedgerEntry[];
  readonly invoiceLines: readonly InvoiceLineSummary[];
  readonly timeLogs: readonly TimeLogEntry[];
}

export interface ProfitabilityResult {
  readonly profitability: EntityProfitability;
  readonly skippedEntries: number;
}

export function computeEntityProfitability(input: ProfitabilityInput): ProfitabilityResult {
  const currency = input.currency;
  let skipped = 0;

  let revenue = zero(currency);
  for (const line of input.invoiceLines) {
    if (line.currency !== currency) {
      skipped += 1;
      continue;
    }
    revenue = add(revenue, money(line.amountMinor, currency));
  }

  let disbursements = zero(currency);
  let recharged = zero(currency);
  for (const fee of input.fees) {
    if (fee.currency !== currency) {
      skipped += 1;
      continue;
    }
    const amount = money(fee.amountMinor, currency);
    disbursements = add(disbursements, amount);
    if (fee.recharged) recharged = add(recharged, amount);
  }

  let timeCostMinor = 0;
  let loggedMinutes = 0;
  for (const log of input.timeLogs) {
    if (log.currency !== currency) {
      skipped += 1;
      continue;
    }
    loggedMinutes += log.minutes;
    timeCostMinor += Math.round((log.minutes / 60) * log.hourlyCostMinor);
  }
  const timeCost = money(timeCostMinor, currency);

  const netMinor = revenue.amountMinor - disbursements.amountMinor - timeCost.amountMinor;

  return {
    profitability: {
      entityId: input.entityId,
      currency,
      revenue,
      disbursements,
      recharged,
      unrecharged: subtract(disbursements, recharged),
      timeCost,
      netMinor,
      net: money(netMinor, currency),
      marginPct: revenue.amountMinor === 0 ? null : netMinor / revenue.amountMinor,
      loggedMinutes,
    },
    skippedEntries: skipped,
  };
}

/**
 * Fees that are out of the door with nothing recovering them. Sorted biggest
 * first, because this is a screen someone works down on a Friday afternoon.
 */
export function unrechargedFees(fees: readonly FeeLedgerEntry[]): FeeLedgerEntry[] {
  return fees
    .filter((fee) => !fee.recharged && fee.invoiceId === null && fee.paidOn !== null)
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

/** Fees marked recharged but with no invoice behind them — a reconciliation gap. */
export function reconciliationExceptions(fees: readonly FeeLedgerEntry[]): FeeLedgerEntry[] {
  return fees.filter((fee) => fee.recharged && fee.invoiceId === null);
}

// ---------------------------------------------------------------------------
// Product metrics
// ---------------------------------------------------------------------------

export interface RenewalOutcome {
  readonly dueOn: PlainDate;
  readonly completedOn: PlainDate | null;
  readonly status: string;
}

/**
 * The customer's core KPI and therefore the dashboard headline: of the renewals
 * that have come due, how many were closed on or before the day they were due.
 *
 * A renewal still open past its due date counts against the rate. Excluding it
 * until someone closes it would let the number look good precisely when things
 * are going worst.
 */
export function onTimeRenewalRate(
  renewals: readonly RenewalOutcome[],
  asOf: PlainDate,
): { rate: number | null; onTime: number; late: number; total: number } {
  let onTime = 0;
  let late = 0;

  for (const renewal of renewals) {
    if (renewal.status === 'cancelled') continue;

    const isDue = daysBetween(renewal.dueOn, asOf) >= 0;
    if (renewal.completedOn !== null) {
      if (daysBetween(renewal.completedOn, renewal.dueOn) >= 0) onTime += 1;
      else late += 1;
    } else if (isDue) {
      late += 1;
    }
  }

  const total = onTime + late;
  return { rate: total === 0 ? null : onTime / total, onTime, late, total };
}

/**
 * Time to first 50 entities loaded — onboarding is the whole risk, so this is
 * measured from the day the org was created, in days. `null` while the account
 * is still below 50.
 */
export function timeToFiftyEntities(
  orgCreatedOn: PlainDate,
  entityCreatedDates: readonly PlainDate[],
): number | null {
  if (entityCreatedDates.length < 50) return null;
  const sorted = [...entityCreatedDates].sort();
  const fiftieth = sorted[49]!;
  return daysBetween(orgCreatedOn, fiftieth);
}
