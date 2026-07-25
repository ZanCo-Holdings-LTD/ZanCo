import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getSession } from '@/lib/session';

/**
 * Root.
 *
 * There is no marketing page here — this is the application. A signed-in user
 * with an organisation goes straight to the evening screen; anyone else goes to
 * sign-in or onboarding.
 */
export default async function RootPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect('/sign-in');
  redirect('/reports');
}
