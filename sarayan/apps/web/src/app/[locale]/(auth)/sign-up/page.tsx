import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { SignUpForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create your account", robots: { index: false } };

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const { locale: raw } = await params;
  const { plan } = await searchParams;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);

  if (await currentSession()) redirect(`/${locale}/app`);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
        {t("auth.signUpTitle")}
      </h1>
      <p className="mb-8 mt-2 text-sm text-ink-500 dark:text-ink-400">{t("auth.signUpSubtitle")}</p>
      <SignUpForm locale={locale} plan={plan} />
    </>
  );
}
