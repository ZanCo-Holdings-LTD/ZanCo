import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { SignInForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);

  if (await currentSession()) redirect(`/${locale}/app`);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
        {t("auth.signInTitle")}
      </h1>
      <p className="mb-8 mt-2 text-sm text-ink-500 dark:text-ink-400">{t("auth.signInSubtitle")}</p>
      <SignInForm locale={locale} />
    </>
  );
}
