import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getSession, currentUser } from '@/lib/session';
import { SignInForm } from '@/components/SignInForm';

/**
 * Sign in.
 *
 * Magic link only. Surveyors sign in on a laptop in the evening having last
 * used the app on a phone that morning; a password is one more thing to have
 * forgotten between the two.
 */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (session) redirect('/reports');

  // Signed in but with no organisation: first login, needs onboarding.
  const user = await currentUser();
  if (user) redirect('/onboarding');

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Fieldnote</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Walk the property talking. Review the report this evening.
      </p>
      <div className="mt-8">
        <SignInForm />
      </div>
    </main>
  );
}
