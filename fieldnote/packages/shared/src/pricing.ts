/**
 * Seat pricing. £100k MRR is roughly 350 firm accounts at £290, not 1,450
 * individuals — the tiers exist to make the team plan the obvious choice at
 * three seats.
 */

export type PlanId = 'solo_monthly' | 'team_monthly' | 'annual' | 'founding';

export interface Plan {
  id: PlanId;
  name: string;
  /** Pence per seat per billing period. Integer money only. */
  unitAmountPence: number;
  interval: 'month' | 'year';
  minSeats: number;
  description: string;
  /** Capped total seats across all customers, for the locked founding rate. */
  globalSeatCap?: number;
}

export const PLANS: Record<PlanId, Plan> = {
  solo_monthly: {
    id: 'solo_monthly',
    name: 'Solo',
    unitAmountPence: 6900,
    interval: 'month',
    minSeats: 1,
    description: 'Per seat, monthly. For individual surveyors.',
  },
  team_monthly: {
    id: 'team_monthly',
    name: 'Team',
    unitAmountPence: 5900,
    interval: 'month',
    minSeats: 3,
    description: 'Per seat, monthly, for teams of three or more.',
  },
  annual: {
    id: 'annual',
    name: 'Annual',
    unitAmountPence: 69000,
    interval: 'year',
    minSeats: 1,
    description: 'Per seat, billed yearly. Two months free against the solo rate.',
  },
  founding: {
    id: 'founding',
    name: 'Founding',
    unitAmountPence: 3900,
    interval: 'month',
    minSeats: 1,
    description: 'Locked founding rate for the first fifty seats.',
    globalSeatCap: 50,
  },
};

/**
 * The plan a given seat count should be on. A team on the solo plan that grows
 * to three seats is moved to the team rate automatically at renewal — net
 * revenue retention comes from seat expansion, not from overcharging.
 */
export function recommendedPlan(seats: number, foundingSeatsRemaining: number): PlanId {
  if (foundingSeatsRemaining >= seats) return 'founding';
  return seats >= PLANS.team_monthly.minSeats ? 'team_monthly' : 'solo_monthly';
}

export function monthlyRevenuePence(planId: PlanId, seats: number): number {
  const plan = PLANS[planId];
  const perMonth =
    plan.interval === 'year' ? Math.round(plan.unitAmountPence / 12) : plan.unitAmountPence;
  return perMonth * seats;
}

export function formatPence(pence: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}
