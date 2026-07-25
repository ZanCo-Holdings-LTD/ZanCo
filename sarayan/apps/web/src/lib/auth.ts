import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import { memberships, organisations, sessions, users, type MemberRole, type Organisation, type User } from "@/db/schema";
import { env } from "./env";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";

// Re-exported so callers have one auth entry point.
export { hashPassword, validatePasswordStrength, verifyPassword };

/**
 * Session authentication.
 *
 * The brief names Clerk. This ships a self-contained implementation instead —
 * scrypt password hashing, opaque server-side session tokens, HttpOnly cookies
 * — for one deployment reason: the app boots and is fully usable with only a
 * DATABASE_URL, no third-party account required. The surface here is small and
 * intentionally Clerk-shaped (`currentUser`, `requireSession`), so swapping in
 * a hosted provider later means reimplementing this file and nothing else.
 */

const SESSION_COOKIE = "sarayan_session";
const SESSION_DAYS = 30;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  const headerList = await headers();
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
    ipAddress: clientIp(headerList),
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE);
}

export interface SessionContext {
  user: User;
  organisation: Organisation;
  role: MemberRole;
  /** Every organisation the user belongs to, for the switcher. */
  organisations: Array<{ organisation: Organisation; role: MemberRole }>;
}

/**
 * Resolve the current session.
 *
 * `cache` deduplicates within a single render pass, so a page and its nested
 * server components share one query rather than issuing five.
 */
export const currentSession = cache(async (): Promise<SessionContext | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const memberRows = await db
    .select({ membership: memberships, organisation: organisations })
    .from(memberships)
    .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
    .where(eq(memberships.userId, row.user.id));

  if (memberRows.length === 0) return null;

  const preferredId = cookieStore.get("sarayan_org")?.value;
  const active =
    memberRows.find((member) => member.organisation.id === preferredId) ?? memberRows[0];

  return {
    user: row.user,
    organisation: active.organisation,
    role: active.membership.role,
    organisations: memberRows.map((member) => ({
      organisation: member.organisation,
      role: member.membership.role,
    })),
  };
});

export async function requireSession(): Promise<SessionContext> {
  const session = await currentSession();
  if (!session) {
    // Callers are server components and actions behind the /app layout, which
    // already redirects unauthenticated visitors. Reaching here is a bug.
    throw new AuthError("Not signed in");
  }
  return session;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function switchOrganisation(organisationId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("sarayan_org", organisationId, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 86_400,
  });
}

export function clientIp(headerList: Headers): string | null {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return headerList.get("x-real-ip");
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const attempts = new Map<string, { count: number; resetAt: number }>();

/**
 * In-process rate limiter for sign-in and signup.
 *
 * Deliberately simple: it is per-instance, so it slows a single attacker rather
 * than stopping a distributed one. Behind more than one instance, put a real
 * limiter at the edge — this is the floor, not the ceiling.
 */
export function rateLimit(key: string, limit = 10, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;

  entry.count += 1;
  return true;
}

// Bound the map so a burst of unique keys cannot grow it without limit.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.resetAt < now) attempts.delete(key);
}, 60_000).unref?.();
