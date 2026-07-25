import { AlertTriangle, ArrowRight, CalendarClock, Coins, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/chrome";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import {
  SEO_DOCUMENT_TYPES,
  documentTypeBySlug,
  downstreamImpact,
  estimatePenalty,
  upstreamDependencies,
} from "@/content/taxonomy";
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from "@/lib/i18n";

/**
 * One page per document type per jurisdiction.
 *
 * Statically generated at build time from the taxonomy, with FAQ structured
 * data so the questions can win a rich result. Every fact on the page — cost,
 * validity, penalty band, dependency — is read from the same curated data the
 * product runs on, so the marketing site cannot drift from the app.
 */

export function generateStaticParams() {
  return LOCALES.flatMap((locale) =>
    SEO_DOCUMENT_TYPES.map((type) => ({ locale, slug: type.seo.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const type = documentTypeBySlug(slug);
  if (!type) return {};

  return {
    title: type.seo.title,
    description: type.seo.metaDescription,
    alternates: {
      canonical: `/${locale}/guides/${slug}`,
      languages: { en: `/en/guides/${slug}`, ar: `/ar/guides/${slug}` },
    },
    openGraph: { title: type.seo.title, description: type.seo.metaDescription, type: "article" },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const type = documentTypeBySlug(slug);
  if (!type) notFound();

  const downstream = downstreamImpact(type.code);
  const upstream = upstreamDependencies(type.code);
  const penalty30 = estimatePenalty(type.code, 30);
  const penalty90 = estimatePenalty(type.code, 90);

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: type.seo.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: type.seo.title,
    description: type.seo.metaDescription,
    author: { "@type": "Organization", name: "Sarayan" },
    publisher: { "@type": "Organization", name: "Sarayan" },
    inLanguage: locale === "ar" ? "ar-AE" : "en-GB",
  };

  return (
    <MarketingShell locale={locale} path={`/guides/${slug}`}>
      <script
        type="application/ld+json"
        // Structured data from our own curated content, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify([faqSchema, articleSchema]) }}
      />

      <article className="mx-auto max-w-4xl px-4 py-14">
        <nav className="mb-6 text-sm text-ink-500 dark:text-ink-400">
          <Link href={`/${locale}/guides`} className="hover:text-ink-800 dark:hover:text-ink-200">
            {locale === "ar" ? "الأدلة" : "Guides"}
          </Link>
          <span className="mx-2">/</span>
          <span>{type.jurisdiction === "national" ? type.country : type.jurisdiction}</span>
        </nav>

        <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight text-ink-950 dark:text-ink-50">
          {type.seo.title}
        </h1>

        {/* Fact panel — the numbers people came for, above the fold */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            icon={CalendarClock}
            label={locale === "ar" ? "مدة الصلاحية" : "Validity"}
            value={
              type.typicalValidityMonths
                ? locale === "ar"
                  ? `${type.typicalValidityMonths} شهراً`
                  : `${type.typicalValidityMonths} months`
                : locale === "ar"
                  ? "بلا مدة محددة"
                  : "No fixed term"
            }
          />
          <Fact
            icon={CalendarClock}
            label={locale === "ar" ? "ابدأ قبل" : "Start renewal"}
            value={
              locale === "ar"
                ? `${type.renewalLeadDays} يوماً`
                : `${type.renewalLeadDays} days ahead`
            }
          />
          <Fact
            icon={Coins}
            label={locale === "ar" ? "التكلفة التقديرية" : "Typical cost"}
            value={
              type.typicalRenewalCost
                ? `${type.typicalRenewalCost.currency} ${type.typicalRenewalCost.amount.toLocaleString()}`
                : "—"
            }
          />
          <Fact icon={Landmark} label={locale === "ar" ? "الجهة" : "Authority"} value={type.issuingAuthority} />
        </div>

        <div className="prose-sarayan mt-10 text-ink-700 dark:text-ink-300">
          {type.seo.intro.map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}

          <h2>{locale === "ar" ? "خطوات التجديد" : "How to renew"}</h2>
          <ol className="mt-4 space-y-5">
            {type.seo.steps.map((step, index) => (
              <li key={step.heading} className="flex gap-4">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
                  {index + 1}
                </span>
                <div>
                  <h3 className="!mt-0 text-base font-semibold text-ink-900 dark:text-ink-100">
                    {step.heading}
                  </h3>
                  <p className="!mt-1">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Penalties */}
        {type.penalties.length > 0 ? (
          <Card className="mt-10 border-amber-mid/40">
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-deep" aria-hidden />
                <h2 className="text-lg font-semibold text-ink-950 dark:text-ink-50">
                  {locale === "ar" ? "الغرامات عند التأخر" : "What late renewal costs"}
                </h2>
              </div>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                    {locale === "ar" ? "بعد ٣٠ يوماً" : "30 days late"}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-amber-deep">
                    {penalty30 ? `${penalty30.currency} ${penalty30.amount.toLocaleString()}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">
                    {locale === "ar" ? "بعد ٩٠ يوماً" : "90 days late"}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-danger-deep">
                    {penalty90 ? `${penalty90.currency} ${penalty90.amount.toLocaleString()}` : "—"}
                  </dd>
                </div>
              </dl>
              {penalty90 ? (
                <ul className="mt-4 space-y-1 text-sm text-ink-600 dark:text-ink-300">
                  {penalty90.breakdown.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              <Link
                href={`/${locale}/calculators/fine-estimator?type=${type.code}`}
                className="mt-5 inline-block"
              >
                <Button variant="secondary" size="sm" className="gap-2">
                  {locale === "ar" ? "احسب غرامتك" : "Estimate your fine"}
                  <ArrowRight className="size-3.5 flip-in-rtl" aria-hidden />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {/* Dependency graph */}
        {downstream.length > 0 || upstream.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-ink-950 dark:text-ink-50">
              {locale === "ar" ? "الاعتماديات" : "What this connects to"}
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {upstream.length > 0 ? (
                <Card>
                  <CardContent className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                      {locale === "ar" ? "يجب أن يكون سارياً أولاً" : "Must be valid first"}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {upstream.map((dependency) => (
                        <li key={dependency.code} className="text-sm">
                          {dependency.seo ? (
                            <Link
                              href={`/${locale}/guides/${dependency.seo.slug}`}
                              className="text-brand-700 hover:underline dark:text-brand-400"
                            >
                              {locale === "ar" ? dependency.nameAr : dependency.nameEn}
                            </Link>
                          ) : (
                            <span className="text-ink-700 dark:text-ink-300">
                              {locale === "ar" ? dependency.nameAr : dependency.nameEn}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}

              {downstream.length > 0 ? (
                <Card className="border-danger-mid/30">
                  <CardContent className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-danger-deep">
                      {locale === "ar" ? "ينهار إذا انتهت" : "Breaks when this lapses"}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {downstream.map((impact) => (
                        <li key={impact.code} className="text-sm">
                          {impact.seo ? (
                            <Link
                              href={`/${locale}/guides/${impact.seo.slug}`}
                              className="text-brand-700 hover:underline dark:text-brand-400"
                            >
                              {locale === "ar" ? impact.nameAr : impact.nameEn}
                            </Link>
                          ) : (
                            <span className="text-ink-700 dark:text-ink-300">
                              {locale === "ar" ? impact.nameAr : impact.nameEn}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <ul className="mt-4 space-y-2">
              {type.consequences.map((consequence) => (
                <li key={consequence.effect} className="flex items-start gap-2 text-sm">
                  <Badge
                    tone={consequence.severity === "blocking" ? "expired" : "due_soon"}
                    className="mt-0.5 shrink-0"
                  >
                    {consequence.severity === "blocking"
                      ? locale === "ar"
                        ? "يوقف"
                        : "Blocks"
                      : consequence.severity === "financial"
                        ? locale === "ar"
                          ? "مالي"
                          : "Cost"
                        : locale === "ar"
                          ? "تشغيلي"
                          : "Operational"}
                  </Badge>
                  <span className="text-ink-700 dark:text-ink-300">{consequence.effect}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* FAQs */}
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-ink-950 dark:text-ink-50">
            {locale === "ar" ? "أسئلة شائعة" : "Common questions"}
          </h2>
          <dl className="mt-4 divide-y divide-ink-100 dark:divide-ink-800">
            {type.seo.faqs.map((faq) => (
              <div key={faq.question} className="py-5">
                <dt className="font-medium text-ink-900 dark:text-ink-100">{faq.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Related */}
        {type.seo.related.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {locale === "ar" ? "اقرأ أيضاً" : "Related"}
            </h2>
            <ul className="mt-3 space-y-1.5">
              {type.seo.related.map((relatedSlug) => {
                const related = documentTypeBySlug(relatedSlug);
                return (
                  <li key={relatedSlug}>
                    <Link
                      href={`/${locale}/guides/${relatedSlug}`}
                      className="text-sm text-brand-700 hover:underline dark:text-brand-400"
                    >
                      {related ? related.seo.title : relatedSlug}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="mt-14 rounded-card bg-ink-950 p-8 dark:bg-ink-900">
          <h2 className="text-xl font-semibold text-white">
            {locale === "ar"
              ? "توقّف عن متابعة هذه التواريخ يدوياً"
              : "Stop tracking this date by hand"}
          </h2>
          <p className="mt-2 max-w-lg text-sm text-ink-300">
            {locale === "ar"
              ? "أضف هذه الوثيقة إلى سجل يُنبّهك قبل ٩٠ و٦٠ و٣٠ و١٤ و٧ ويوم واحد — ويصعّد حتى يستلمها أحد."
              : "Add this document to a register that warns you at 90, 60, 30, 14, 7 and 1 day — and escalates until somebody acknowledges it."}
          </p>
          <Link href={`/${locale}/sign-up`} className="mt-6 inline-block">
            <Button>{locale === "ar" ? "ابدأ مجاناً" : "Start free"}</Button>
          </Link>
        </div>

        <p className="mt-8 text-xs leading-relaxed text-ink-400">
          {locale === "ar"
            ? "الأرقام أعلاه تقديرية ومبنية على الجداول المنشورة وقت الكتابة، وقد تتغير. تحقّق من الجهة المصدرة قبل الاعتماد عليها. هذه المعلومات ليست استشارة قانونية."
            : "The figures above are estimates based on published schedules at the time of writing and can change. Confirm with the issuing authority before relying on them. This is not legal advice."}
        </p>
      </article>
    </MarketingShell>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <Icon className="size-4 text-ink-400" aria-hidden />
      <p className="mt-2 text-xs uppercase tracking-wide text-ink-500 dark:text-ink-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink-900 dark:text-ink-100">{value}</p>
    </div>
  );
}
