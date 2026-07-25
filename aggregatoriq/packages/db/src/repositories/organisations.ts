/**
 * Organisations, members and org creation on first login.
 *
 * Every database access in the product goes through a repository function. The
 * reason is not tidiness: it is that RLS depends on a transaction-local session
 * variable, and a repository that takes a `Transaction` cannot be called from
 * outside one. Ad-hoc queries scattered through route handlers are how a query
 * ends up running without a tenant scope.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { MemberRole } from '@aggregatoriq/core';
import type { Transaction } from '../client.js';
import { appUsers, orgMembers, organisations } from '../schema.js';

export interface OrganisationRecord {
  id: string;
  name: string;
  country: string;
  baseCurrency: string;
  defaultLocale: string;
  materialityThresholdMinor: number;
}

export interface MembershipRecord extends OrganisationRecord {
  role: MemberRole;
}

/**
 * Make sure the signed-in user has a local row.
 *
 * Called on every authenticated request's first database touch. The auth
 * provider owns identity; this mirror exists so memberships and assignee columns
 * can carry a real foreign key.
 */
export async function ensureAppUser(
  tx: Transaction,
  user: { id: string; email: string; fullName?: string | null },
): Promise<void> {
  await tx
    .insert(appUsers)
    .values({ id: user.id, email: user.email, fullName: user.fullName ?? null })
    .onConflictDoUpdate({
      target: appUsers.id,
      set: { email: user.email, fullName: user.fullName ?? null },
    });
}

/**
 * Create an organisation and make the caller its owner, in one transaction.
 *
 * The two statements have to be atomic. An organisation with no members is
 * unreachable — the RLS policies key off membership — and would sit in the table
 * forever with nobody able to see or delete it.
 */
export async function createOrganisationWithOwner(
  tx: Transaction,
  input: {
    name: string;
    country?: string;
    baseCurrency?: string;
    defaultLocale?: string;
    ownerUserId: string;
  },
): Promise<OrganisationRecord> {
  const [created] = await tx
    .insert(organisations)
    .values({
      name: input.name.trim(),
      country: input.country ?? 'AE',
      baseCurrency: input.baseCurrency ?? 'AED',
      defaultLocale: input.defaultLocale ?? 'en',
    })
    .returning();

  if (!created) throw new Error('Organisation insert returned no row');

  await tx.insert(orgMembers).values({
    orgId: created.id,
    userId: input.ownerUserId,
    role: 'owner',
  });

  return toOrganisationRecord(created);
}

export async function listMembershipsForUser(
  tx: Transaction,
  userId: string,
): Promise<MembershipRecord[]> {
  const rows = await tx
    .select({
      id: organisations.id,
      name: organisations.name,
      country: organisations.country,
      baseCurrency: organisations.baseCurrency,
      defaultLocale: organisations.defaultLocale,
      materialityThresholdMinor: organisations.materialityThresholdMinor,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(organisations, eq(organisations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(organisations.name);

  return rows.map((row) => ({ ...toOrganisationRecord(row), role: row.role }));
}

export async function getOrganisation(
  tx: Transaction,
  orgId: string,
): Promise<OrganisationRecord | null> {
  const [row] = await tx.select().from(organisations).where(eq(organisations.id, orgId)).limit(1);
  return row ? toOrganisationRecord(row) : null;
}

export async function getMemberRole(
  tx: Transaction,
  orgId: string,
  userId: string,
): Promise<MemberRole | null> {
  const [row] = await tx
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

export async function updateOrganisationSettings(
  tx: Transaction,
  orgId: string,
  changes: {
    name?: string;
    defaultLocale?: string;
    materialityThresholdMinor?: number;
    baseCurrency?: string;
  },
): Promise<void> {
  await tx.update(organisations).set(changes).where(eq(organisations.id, orgId));
}

export async function listMembers(
  tx: Transaction,
  orgId: string,
): Promise<{ userId: string; email: string; fullName: string | null; role: MemberRole }[]> {
  return tx
    .select({
      userId: appUsers.id,
      email: appUsers.email,
      fullName: appUsers.fullName,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(appUsers, eq(appUsers.id, orgMembers.userId))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(appUsers.email);
}

export async function setMemberRole(
  tx: Transaction,
  orgId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await tx
    .update(orgMembers)
    .set({ role })
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
}

/**
 * Remove a member, refusing to remove the last owner.
 *
 * Same reasoning as org creation: an organisation with no owner cannot be
 * administered, and recovering one means a support request and a manual
 * database edit.
 */
export async function removeMember(
  tx: Transaction,
  orgId: string,
  userId: string,
): Promise<{ removed: boolean; reason?: string }> {
  const ownerCounts = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));

  const ownerCount = Number(ownerCounts[0]?.count ?? 0);
  const role = await getMemberRole(tx, orgId, userId);
  if (role === 'owner' && ownerCount <= 1) {
    return {
      removed: false,
      reason: 'An organisation must keep at least one owner. Promote another member first.',
    };
  }

  await tx
    .delete(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  return { removed: true };
}

function toOrganisationRecord(row: {
  id: string;
  name: string;
  country: string;
  baseCurrency: string;
  defaultLocale: string;
  materialityThresholdMinor: number;
}): OrganisationRecord {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    baseCurrency: row.baseCurrency,
    defaultLocale: row.defaultLocale,
    materialityThresholdMinor: Number(row.materialityThresholdMinor),
  };
}
