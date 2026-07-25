import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client.
 *
 * Kept in its own module, separate from the server client. They were together
 * once, and the shared module pulled `next/headers` into every client component
 * that imported it — which fails the production build, and would have shipped
 * server-only code to the browser if it had not.
 *
 * Only the anon key is used here. It is designed to be public; RLS is what
 * makes that safe.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
