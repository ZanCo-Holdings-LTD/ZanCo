import { type NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient } from '@supabase/ssr';
import { routing } from '@/i18n/routing';

/**
 * Locale negotiation and session refresh, in that order.
 *
 * The Supabase session must be refreshed on every request or a reviewer working
 * through a long report is signed out mid-edit. Cookies set by the refresh are
 * copied onto whatever response the intl middleware produced, so a redirect for
 * locale does not drop the refreshed session.
 */

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touching the user is what triggers the refresh; the result is unused here
  // because authorisation happens in the page, under RLS.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation and the API routes,
    // which do their own auth and are locale-independent.
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)',
  ],
};

export { NextResponse };
