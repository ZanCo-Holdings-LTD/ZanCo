import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { repositories } from '@aggregatoriq/db';
import type { MemberRole } from '@aggregatoriq/core';
import { hasAtLeastRole } from '@aggregatoriq/core';
import { publicEnv } from '@/env';
import { asUser } from './db';

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
}

/**
 * Supabase owns identity; this app owns membership.
 *
 * The distinction matters: a valid session says who someone is, and says nothing
 * about which organisation's data they may see. That second question is answered
 * by `org_members` and enforced by row-level security.
 */
export async function supabase() {
  const env = publicEnv();
  const store = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          for (const item of items) store.set(item.name, item.value, item.options);
        } catch {
          // Called from a server component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

export async function currentUser(): Promise<SessionUser | null> {
  const client = await supabase();
  const { data, error } = await client.auth.getUser();

  if (error !== null || data.user === null) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? '',
    fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
  };
}

export interface Membership {
  readonly user: SessionUser;
  readonly orgId: string;
  readonly orgName: string;
  readonly role: MemberRole;
  readonly baseCurrency: string;
  readonly country: string;
  readonly materialityThresholdMinor: number;
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'NotAuthenticatedError';
  }
}

export class NoOrganisationError extends Error {
  constructor() {
    super('Signed in but not a member of any organisation');
    this.name = 'NoOrganisationError';
  }
}

export class InsufficientRoleError extends Error {
  constructor(required: MemberRole, actual: MemberRole) {
    super(`This action needs the ${required} role or higher; you have ${actual}.`);
    this.name = 'InsufficientRoleError';
  }
}

/**
 * The organisation the request is acting for.
 *
 * `preferredOrgId` comes from the org switcher. It is checked against actual
 * membership rather than trusted — the cookie is under the user's control, and
 * an unchecked one would be a tenant boundary made of client state.
 */
export async function requireMembership(preferredOrgId?: string): Promise<Membership> {
  const user = await currentUser();
  if (user === null) throw new NotAuthenticatedError();

  const memberships = await asUser(user.id, async (tx) => {
    await repositories.organisations.ensureAppUser(tx, user);
    return repositories.organisations.listMembershipsForUser(tx, user.id);
  });

  if (memberships.length === 0) throw new NoOrganisationError();

  const chosen =
    (preferredOrgId !== undefined
      ? memberships.find((membership) => membership.id === preferredOrgId)
      : undefined) ?? memberships[0]!;

  return {
    user,
    orgId: chosen.id,
    orgName: chosen.name,
    role: chosen.role,
    baseCurrency: chosen.baseCurrency,
    country: chosen.country,
    materialityThresholdMinor: chosen.materialityThresholdMinor,
  };
}

export async function listMemberships(userId: string) {
  return asUser(userId, (tx) => repositories.organisations.listMembershipsForUser(tx, userId));
}

export function requireRole(membership: Membership, required: MemberRole): void {
  if (!hasAtLeastRole(membership.role, required)) {
    throw new InsufficientRoleError(required, membership.role);
  }
}

/** The org the switcher last selected. Advisory: membership is always rechecked. */
export async function selectedOrgId(): Promise<string | undefined> {
  const store = await cookies();
  return store.get('aiq_org')?.value;
}
