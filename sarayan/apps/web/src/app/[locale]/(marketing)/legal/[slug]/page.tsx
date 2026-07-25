import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/chrome";
import { LEGAL_DOCUMENTS, legalDocument } from "@/content/legal";
import { DEFAULT_LOCALE, LOCALES, formatDate, isLocale, type Locale } from "@/lib/i18n";

export function generateStaticParams() {
  return LOCALES.flatMap((locale) =>
    LEGAL_DOCUMENTS.map((document) => ({ locale, slug: document.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const document = legalDocument(slug);
  if (!document) return {};
  return { title: document.title, description: document.summary };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const document = legalDocument(slug);
  if (!document) notFound();

  return (
    <MarketingShell locale={locale} path={`/legal/${slug}`}>
      <article className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {document.title}
        </h1>
        <p className="mt-3 text-lg text-ink-600 dark:text-ink-300">{document.summary}</p>
        <p className="mt-2 text-sm text-ink-400">
          {locale === "ar" ? "آخر تحديث" : "Last updated"} {formatDate(document.updated, locale)}
        </p>

        {/* Legal text is authoritative in English; the surrounding UI is localised. */}
        <div className="prose-sarayan mt-10 text-ink-700 dark:text-ink-300" lang="en" dir="ltr">
          {document.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
              {section.bullets ? (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet.slice(0, 40)}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        {locale === "ar" ? (
          <p className="mt-10 rounded-lg bg-ink-100 p-4 text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            النص القانوني أعلاه مُعتمد بالإنجليزية. نسخة عربية مُوقّعة متاحة عند الطلب من
            privacy@sarayan.app.
          </p>
        ) : null}
      </article>
    </MarketingShell>
  );
}
