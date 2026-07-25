import 'server-only';
import { cookies } from 'next/headers';
import { getDb, repositories, withUser } from '@fieldnote/db';
import type { Database } from '@fieldnote/db';
import { forbidden, roleAtLeast, unauthorized, type OrgRole } from '@fieldnote/shared';
import { serverClient } from './supabase/server';

/**
 * Request session.
 *
 * Resolves who is calling and which organisation they are acting in, then hands
 * back a database handle scoped to them.
 *
 * The org id comes from a cookie, but it is never trusted: `withUser` runs
 * every query under RLS as that user, so a forged cookie naming another
 * tenant's org simply returns nothing. The membership lookup below exists to
 * give a clean 403 instead of a confusing empty page.
 */

const ORG_COOKIE = 'fieldnote_org';

export interface Session {
  userId: string;
  email: string | null;
  orgId: string;
  role: OrgRole;
}

/**
 * Connection pool, resolved lazily.
 *
 * Opening it at module scope means `next build` tries to connect while
 * collecting page data, so a build with no DATABASE_URL fails — and every
 * module that transitively imports this one becomes untestable without a live
 * database. Serverless functions get a small pool because each instance handles
 * one request at a time.
 */
let pool: Database | undefined;

function db(): Database {
  pool ??= getDb({ max: 5 });
  return pool;
}

export async function currentUser(): Promise<{ userId: string; email: string | null } | null> {
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { userId: user.id, email: user.email ?? null };
}

/**
 * The caller's session, or null when signed out or without an organisation.
 *
 * On first sign-in a user has no org; the caller sends them to onboarding
 * rather than treating it as an error.
 */
export async function getSession(): Promise<Session | null> {
  const user = await currentUser();
  if (!user) return null;

  const memberships = await withUser(db(), user.userId, (tx) =>
    repositories.organisations.listForUser(tx, user.userId),
  );
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const requested = cookieStore.get(ORG_COOKIE)?.value;

  // A cookie naming an org the user does not belong to falls back to their
  // first membership rather than failing — most often it is a stale cookie
  // after being removed from a team, not an attack.
  const active = memberships.find((org) => org.id === requested) ?? memberships[0]!;

  return {
    userId: user.userId,
    email: user.email,
    orgId: active.id,
    role: active.role,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw unauthorized();
  return session;
}

export async function requireRole(minimum: OrgRole): Promise<Session> {
  const session = await requireSession();
  if (!roleAtLeast(session.role, minimum)) {
    throw forbidden(`This action requires the ${minimum} role`);
  }
  return session;
}

/**
 * Run a query as the signed-in user, with RLS applied.
 *
 * Every read and write in the web app goes through here. There is no
 * service-role path in this application — the worker owns that.
 */
export async function query<T>(session: Session, fn: (tx: Database) => Promise<T>): Promise<T> {
  return withUser(db(), session.userId, fn);
}

export async function listOrganisations(userId: string) {
  return withUser(db(), userId, (tx) => repositories.organisations.listForUser(tx, userId));
}

export const ORG_COOKIE_NAME = ORG_COOKIE;
