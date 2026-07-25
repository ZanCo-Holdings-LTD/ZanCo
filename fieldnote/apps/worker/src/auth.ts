import { createHmac, timingSafeEqual } from 'node:crypto';
import { jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@fieldnote/shared';
import { env } from './env.js';

/**
 * Two ways in, and they are deliberately different.
 *
 *  - A signed-in user presents a Supabase JWT. Used by the mobile app's upload
 *    endpoints and by anything acting on behalf of a person.
 *  - The web app presents a shared secret. Used only for enqueueing jobs, which
 *    is a machine-to-machine action with no user identity of its own.
 *
 * Nothing else is accepted, and /health is the only unauthenticated route.
 */

const jwtSecret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);

export interface AuthenticatedUser {
  userId: string;
  email: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export async function verifySupabaseJwt(token: string): Promise<AuthenticatedUser> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret, {
      algorithms: ['HS256'],
      // Supabase issues `authenticated` for signed-in users; anything else is
      // an anon or service token and has no business here.
      audience: 'authenticated',
    });

    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) throw new Error('token has no subject');

    return {
      userId,
      email: typeof payload.email === 'string' ? payload.email : null,
    };
  } catch (error: unknown) {
    throw new AppError('unauthorized', 'Invalid or expired token', { cause: error });
  }
}

/** Fastify preHandler: requires a valid user token. */
export async function requireUser(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('unauthorized', 'Missing bearer token');
  }
  request.user = await verifySupabaseJwt(header.slice('Bearer '.length));
}

/**
 * Fastify preHandler: requires the internal shared secret.
 *
 * Compared in constant time. A timing oracle on this token would let an
 * attacker enqueue jobs against any tenant.
 */
export async function requireInternal(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const presented = request.headers['x-internal-token'];
  if (typeof presented !== 'string') {
    throw new AppError('unauthorized', 'Missing internal token');
  }

  const expected = Buffer.from(env.WORKER_INTERNAL_TOKEN);
  const actual = Buffer.from(presented);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AppError('unauthorized', 'Invalid internal token');
  }
}

/**
 * Verify a Resend webhook signature.
 *
 * Without this an unauthenticated caller could mark any report as delivered and
 * opened, which is a record customers may rely on in a dispute.
 */
export function verifyResendSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.replace(/^sha256=/, '');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
