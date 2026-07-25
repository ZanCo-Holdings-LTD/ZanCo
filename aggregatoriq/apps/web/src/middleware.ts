import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale negotiation only.
 *
 * Authorisation is deliberately not done here. Middleware runs on the edge
 * without a database connection, so anything it could check about a session is a
 * claim from a cookie rather than a fact about membership — and the real
 * boundary is row-level security in Postgres, which applies whether or not a
 * request passed through here.
 *
 * Pages call `requireMembership()` and get a fact.
 */
export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|favicon.ico|.*\\..*).*)'],
};
