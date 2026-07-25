import { and, eq, sql } from 'drizzle-orm';
import { type OrgRole } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { orgMembers, organisations, profiles } from '../schema/orgs.js';
import { subscriptions } from '../schema/billing.js';

export interface OrgSummary {
  id: string;
  name: string;
  role: OrgRole;
}

/** Every org the caller belongs to. Drives the org switcher. */
export async function listForUser(db: Database, userId: string): Promise<OrgSummary[]> {
  const rows = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      role: orgMembers.role,
      createdAt: organisations.createdAt,
    })
    .from(orgMembers)
    .innerJoin(organisations, eq(organisations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(organisations.createdAt);

  return rows.map(({ id, name, role }) => ({ id, name, role }));
}

/**
 * Create an organisation and make the caller its owner, atomically.
 *
 * Delegates to the `create_organisation` SQL function: an org with no owner
 * would be invisible under RLS and therefore unrecoverable, so the two inserts
 * must not be separable.
 */
export async function create(db: Database, name: string): Promise<string> {
  const result = await db.execute<{ create_organisation: string }>(
    sql`select public.create_organisation(${name}) as create_organisation`,
  );
  const orgId = result[0]?.create_organisation;
  if (!orgId) throw new Error('create_organisation returned no id');
  return orgId;
}

export async function findById(db: Database, orgId: string) {
  const [row] = await db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1);
  return row ?? null;
}

export async function rename(db: Database, orgId: string, name: string): Promise<void> {
  await db.update(organisations).set({ name }).where(eq(organisations.id, orgId));
}

export async function listMembers(db: Database, orgId: string) {
  return db
    .select({
      userId: orgMembers.userId,
      role: orgMembers.role,
      invitedEmail: orgMembers.invitedEmail,
      createdAt: orgMembers.createdAt,
      fullName: profiles.fullName,
      companyName: profiles.companyName,
    })
    .from(orgMembers)
    .leftJoin(profiles, eq(profiles.id, orgMembers.userId))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(orgMembers.createdAt);
}

export async function roleOf(db: Database, orgId: string, userId: string): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

export async function addMember(
  db: Database,
  orgId: string,
  userId: string,
  role: OrgRole,
  invitedEmail?: string,
): Promise<void> {
  await db
    .insert(orgMembers)
    .values({ orgId, userId, role, invitedEmail: invitedEmail ?? null })
    .onConflictDoUpdate({
      target: [orgMembers.orgId, orgMembers.userId],
      set: { role },
    });
}

/**
 * Remove a member. Refuses to remove the last owner — an org without an owner
 * has no one who can manage billing or invite a replacement.
 */
export async function removeMember(
  db: Database,
  orgId: string,
  userId: string,
): Promise<{ removed: boolean; reason?: string }> {
  const members = await db
    .select({ userId: orgMembers.userId, role: orgMembers.role })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, orgId));

  const target = members.find((m) => m.userId === userId);
  if (!target) return { removed: false, reason: 'not_a_member' };

  const owners = members.filter((m) => m.role === 'owner');
  if (target.role === 'owner' && owners.length === 1) {
    return { removed: false, reason: 'last_owner' };
  }

  await db
    .delete(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  return { removed: true };
}

export async function seatUsage(
  db: Database,
  orgId: string,
): Promise<{ used: number; purchased: number }> {
  const [{ count = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, orgId));

  const [sub] = await db
    .select({ seats: subscriptions.seats })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);

  return { used: count, purchased: sub?.seats ?? 1 };
}

export async function getProfile(db: Database, userId: string) {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  return row ?? null;
}

export async function upsertProfile(
  db: Database,
  userId: string,
  orgId: string,
  patch: Partial<typeof profiles.$inferInsert>,
): Promise<void> {
  await db
    .insert(profiles)
    .values({ id: userId, orgId, ...patch })
    .onConflictDoUpdate({ target: profiles.id, set: patch });
}
