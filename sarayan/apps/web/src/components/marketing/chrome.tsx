import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { type Locale, translator } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function Logo({ locale, className }: { locale: Locale; className?: string }) {
  const t = translator(locale);
  return (
    <Link href={`/${locale}`} className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-brand-700 text-[13px] font-bold text-white"
      >
        {locale === "ar" ? "س" : "S"}
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink-900 dark:text-ink-50">
        {t("brand.name")}
      </span>
    </Link>
  );
}

/** Swaps locale while preserving the rest of the path. */
export function LocaleSwitch({ locale, path = "" }: { locale: Locale; path?: string }) {
  const other: Locale = locale === "en" ? "ar" : "en";
  return (
    <Link
      href={`/${other}${path}`}
      hrefLang={other}
      className="rounded-md px-2 py-1 text-sm text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800"
    >
      {other === "ar" ? "العربية" : "English"}
    </Link>
  );
}

export function MarketingHeader({ locale, path = "" }: { locale: Locale; path?: string }) {
  const t = translator(locale);
  const links = [
    { href: `/${locale}/pricing`, label: t("nav.pricing") },
    { href: `/${locale}/guides`, label: t("nav.guides") },
    { href: `/${locale}/calculators`, label: t("nav.calculators") },
    { href: `/${locale}/security`, label: t("nav.security") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-[var(--surface)]/85 backdrop-blur dark:border-ink-800">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Logo locale={locale} />
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LocaleSwitch locale={locale} path={path} />
          <Link
            href={`/${locale}/sign-in`}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-700 hover:text-ink-950 dark:text-ink-300 dark:hover:text-ink-50"
          >
            {t("nav.signIn")}
          </Link>
          <Link href={`/${locale}/sign-up`}>
            <Button size="sm">{t("nav.signUp")}</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const columns: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
    {
      title: t("nav.product"),
      links: [
        { href: `/${locale}/pricing`, label: t("nav.pricing") },
        { href: `/${locale}/security`, label: t("nav.security") },
        { href: `/${locale}/verify`, label: t("evidence.verify") },
        { href: `/${locale}/sign-up`, label: t("nav.signUp") },
      ],
    },
    {
      title: t("nav.guides"),
      links: [
        { href: `/${locale}/guides`, label: locale === "ar" ? "كل الأدلة" : "All guides" },
        { href: `/${locale}/calculators/fine-estimator`, label: locale === "ar" ? "حاسبة الغرامات" : "Fine estimator" },
        { href: `/${locale}/calculators/renewal-cost`, label: locale === "ar" ? "حاسبة تكلفة التجديد" : "Renewal cost" },
        {
          href: `/${locale}/templates/employee-document-tracker`,
          label: locale === "ar" ? "قالب متابعة الوثائق" : "Document tracker template",
        },
      ],
    },
    {
      title: locale === "ar" ? "قانوني" : "Legal",
      links: [
        { href: `/${locale}/legal/privacy`, label: locale === "ar" ? "الخصوصية" : "Privacy" },
        { href: `/${locale}/legal/terms`, label: locale === "ar" ? "الشروط" : "Terms" },
        { href: `/${locale}/legal/dpa`, label: locale === "ar" ? "اتفاقية معالجة البيانات" : "DPA" },
        { href: `/${locale}/legal/subprocessors`, label: locale === "ar" ? "المعالجون الفرعيون" : "Subprocessors" },
      ],
    },
  ];

  return (
    <footer className="mt-24 border-t border-ink-200 bg-white/50 dark:border-ink-800 dark:bg-ink-900/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo locale={locale} />
          <p className="mt-3 max-w-xs text-sm text-ink-500 dark:text-ink-400">{t("brand.tagline")}</p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {column.title}
            </h3>
            <ul className="space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-ink-100 px-4 py-5 text-center text-xs text-ink-400 dark:border-ink-800">
        © {new Date().getUTCFullYear()} {t("brand.name")}
      </div>
    </footer>
  );
}

export function MarketingShell({
  locale,
  path,
  children,
}: {
  locale: Locale;
  path?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader locale={locale} path={path} />
      <main className="flex-1">{children}</main>
      <MarketingFooter locale={locale} />
    </div>
  );
}
