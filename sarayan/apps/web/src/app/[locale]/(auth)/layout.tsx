import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/marketing/chrome";
import { DOCUMENT_TYPES } from "@/content/taxonomy";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";

export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const other: Locale = locale === "en" ? "ar" : "en";

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo locale={locale} />
          <Link
            href={`/${other}${locale === "en" ? "" : ""}`}
            className="text-sm text-ink-500 hover:text-ink-800 dark:text-ink-400"
          >
            {other === "ar" ? "العربية" : "English"}
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          {children}
        </div>
      </div>

      {/* The argument, restated where a hesitating signup can still see it. */}
      <aside className="hidden bg-ink-950 p-12 lg:flex lg:flex-col lg:justify-center dark:bg-ink-900">
        <blockquote className="max-w-md">
          <p className="text-2xl font-medium leading-snug text-white">
            {t("marketing.heroTitle")}
          </p>
          <p className="mt-6 leading-relaxed text-ink-300">{t("marketing.problemBody")}</p>
        </blockquote>
        <dl className="mt-12 grid max-w-md grid-cols-3 gap-6">
          {[
            { value: "90/60/30", label: locale === "ar" ? "سلّم التنبيهات" : "Alert ladder" },
            { value: String(DOCUMENT_TYPES.length), label: locale === "ar" ? "نوع وثيقة" : "Document types" },
            { value: "AE · SA", label: locale === "ar" ? "الولايات القضائية" : "Jurisdictions" },
          ].map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs uppercase tracking-wide text-ink-500">{stat.label}</dt>
              <dd className="mt-1 text-lg font-semibold text-white">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
