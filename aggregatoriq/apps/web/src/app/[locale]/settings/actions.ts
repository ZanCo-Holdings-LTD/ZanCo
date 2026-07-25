'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { repositories } from '@aggregatoriq/db';
import { requireMembership, requireRole, selectedOrgId } from '@/lib/auth';
import { asUser } from '@/lib/db';

/**
 * Server actions for settings.
 *
 * Two things every action does before touching data, in this order:
 *
 *   Re-resolve membership from the session. A server action is a public HTTP
 *   endpoint — the form it was rendered next to proves nothing about who is
 *   calling it now.
 *
 *   Check the role. Row-level security stops a member of one organisation
 *   writing to another's rows, but it does not stop a viewer editing their own
 *   organisation's commission rates, and a wrong contracted rate silently
 *   changes every finding the engine produces.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

function invalid(error: z.ZodError): ActionResult {
  return {
    ok: false,
    message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
  };
}

const branchSchema = z.object({
  name: z.string().trim().min(1, 'A branch needs a name'),
  city: z.string().trim().optional(),
  timezone: z.string().trim().min(1),
  currency: z.string().trim().length(3),
});

export async function createBranchAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const membership = await requireMembership(await selectedOrgId());
  requireRole(membership, 'admin');

  const parsed = branchSchema.safeParse({
    name: formData.get('name'),
    city: formData.get('city') ?? undefined,
    timezone: formData.get('timezone'),
    currency: formData.get('currency'),
  });

  if (!parsed.success) return invalid(parsed.error);

  // The timezone is validated against the platform's tz database rather than
  // accepted as a string: it decides which statement period an order falls in,
  // and an unrecognised zone would silently fall back to UTC.
  try {
    new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone });
  } catch {
    return { ok: false, message: `"${parsed.data.timezone}" is not a recognised timezone.` };
  }

  await asUser(membership.user.id, (tx) =>
    repositories.branches.createBranch(tx, {
      orgId: membership.orgId,
      name: parsed.data.name,
      city: parsed.data.city ?? null,
      timezone: parsed.data.timezone,
      currency: parsed.data.currency.toUpperCase(),
    }),
  );

  revalidatePath('/settings');
  return { ok: true, message: 'Branch added.' };
}

const accountSchema = z.object({
  branchId: z.string().uuid(),
  aggregatorId: z.string().uuid(),
  externalStoreId: z.string().trim().min(1),
  commissionPercent: z.coerce.number().min(0).max(100),
  vatTreatment: z.enum(['commission_on_net', 'commission_on_gross', 'zero_rated', 'exempt']),
  payoutCycleDays: z.coerce.number().int().min(1).max(120),
  deliveryFeeBearer: z.enum(['aggregator', 'operator', 'customer']),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('')),
});

export async function createAggregatorAccountAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const membership = await requireMembership(await selectedOrgId());
  requireRole(membership, 'admin');

  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const input = parsed.data;

  try {
    await asUser(membership.user.id, (tx) =>
      repositories.branches.createAggregatorAccount(tx, {
        orgId: membership.orgId,
        branchId: input.branchId,
        aggregatorId: input.aggregatorId,
        externalStoreId: input.externalStoreId,
        // Entered as a percentage because that is how a contract states it;
        // stored as a fraction because that is how the engine multiplies it.
        contractedCommissionRate: input.commissionPercent / 100,
        vatTreatment: input.vatTreatment,
        payoutCycleDays: input.payoutCycleDays,
        deliveryFeeBearer: input.deliveryFeeBearer,
        currency: membership.baseCurrency,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo === '' ? null : (input.effectiveTo ?? null),
      }),
    );
  } catch (error) {
    // The database refuses overlapping rate periods, because "which rate applied
    // in March" has to have one answer. Translate that into something a human
    // can act on rather than showing them a constraint name.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('baa_no_overlapping_periods')) {
      return {
        ok: false,
        message:
          'These dates overlap an existing rate for this branch and aggregator. Close the ' +
          'current period first — the old rate has to keep its dates so past reconciliations ' +
          'still reproduce.',
      };
    }
    throw error;
  }

  revalidatePath('/settings');
  revalidatePath('/margin');
  return { ok: true, message: 'Aggregator account added.' };
}

const materialitySchema = z.object({
  materialityMinor: z.coerce.number().int().min(0).max(1_000_000),
});

export async function updateMaterialityAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const membership = await requireMembership(await selectedOrgId());
  requireRole(membership, 'admin');

  const parsed = materialitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  await asUser(membership.user.id, (tx) =>
    repositories.organisations.updateOrganisationSettings(tx, membership.orgId, {
      materialityThresholdMinor: parsed.data.materialityMinor,
    }),
  );

  revalidatePath('/settings');
  return { ok: true, message: 'Threshold updated. It applies to the next reconciliation run.' };
}
