import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/chrome";
import { Badge } from "@/components/ui";
import { COUNTRIES, SEO_DOCUMENT_TYPES } from "@/content/taxonomy";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Renewal guides for UAE and Saudi government documents",
  description:
    "Cost, timeline and penalty guides for trade licences, visas, iqamas, labour cards, vehicle registration and more across the UAE and Saudi Arabia.",
};

/**
 * The guides index.
 *
 * "One page per document type per jurisdiction… and roughly 300 more." The
 * taxonomy is the generator: adding a document type with SEO content publishes
 * its page, adds it here, and puts it in the sitemap. Content scales by writing
 * content, not by writing routes.
 */
export default async function GuidesIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const byCountry = COUNTRIES.map((country) => ({
    country,
    types: SEO_DOCUMENT_TYPES.filter((type) => type.country === country.code),
  })).filter((group) => group.types.length > 0);

  return (
    <MarketingShell locale={locale} path="/guides">
      <div className="mx-auto max-w-4xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "أدلة التجديد" : "Renewal guides"}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
          {locale === "ar"
            ? "ما تكلفته، وكم يستغرق، وماذا يحدث إن فاتك — لكل نوع وثيقة نتابعه."
            : "What it costs, how long it takes, and what happens if you miss it — for every document type we track."}
        </p>

        {byCountry.map((group) => (
          <section key={group.country.code} className="mt-12">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {locale === "ar" ? group.country.nameAr : group.country.nameEn}
            </h2>
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {group.types.map((type) => (
                <li key={type.code}>
                  <Link
                    href={`/${locale}/guides/${type.seo.slug}`}
                    className="group flex flex-wrap items-baseline gap-x-3 gap-y-1 py-4"
                  >
                    <span className="font-medium text-ink-900 group-hover:text-brand-700 dark:text-ink-100 dark:group-hover:text-brand-400">
                      {locale === "ar" ? type.nameAr : type.nameEn}
                    </span>
                    <Badge tone="neutral">
                      {type.jurisdiction === "national"
                        ? locale === "ar"
                          ? "اتحادي"
                          : "National"
                        : type.jurisdiction}
                    </Badge>
                    <span className="text-sm text-ink-500 dark:text-ink-400">
                      {type.issuingAuthority}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </MarketingShell>
  );
}
