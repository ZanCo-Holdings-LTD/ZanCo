import { ArrowRight, BellRing, FileCheck2, GitBranch, ScanLine, Users } from "lucide-react";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/chrome";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { SEO_DOCUMENT_TYPES } from "@/content/taxonomy";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);

  const features = [
    { icon: BellRing, title: t("marketing.featureAlertsTitle"), body: t("marketing.featureAlertsBody") },
    { icon: ScanLine, title: t("marketing.featureExtractionTitle"), body: t("marketing.featureExtractionBody") },
    { icon: FileCheck2, title: t("marketing.featureEvidenceTitle"), body: t("marketing.featureEvidenceBody") },
    { icon: GitBranch, title: t("marketing.featureDependencyTitle"), body: t("marketing.featureDependencyBody") },
    { icon: Users, title: t("marketing.featureAgencyTitle"), body: t("marketing.featureAgencyBody") },
  ];

  const ladder = [90, 60, 30, 14, 7, 1];

  return (
    <MarketingShell locale={locale}>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-200 dark:border-ink-800">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 text-ink-400 opacity-40 grid-lines"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 md:py-28">
          <Badge tone="valid" className="mb-5">
            {t("marketing.heroEyebrow")}
          </Badge>
          <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-ink-950 md:text-6xl dark:text-ink-50">
            {t("marketing.heroTitle")}
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-ink-600 dark:text-ink-300">
            {t("marketing.heroBody")}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href={`/${locale}/sign-up`}>
              <Button size="lg" className="gap-2">
                {t("marketing.heroCtaPrimary")}
                <ArrowRight className="size-4 flip-in-rtl" aria-hidden />
              </Button>
            </Link>
            <Link href={`/${locale}/pricing`}>
              <Button size="lg" variant="secondary">
                {t("nav.pricing")}
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-500 dark:text-ink-400">{t("marketing.heroNote")}</p>
        </div>
      </section>

      {/* The problem */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
              {t("marketing.problemTitle")}
            </h2>
            <p className="mt-5 text-pretty leading-relaxed text-ink-600 dark:text-ink-300">
              {t("marketing.problemBody")}
            </p>
            <p className="mt-4 leading-relaxed text-ink-600 dark:text-ink-300">
              {locale === "ar"
                ? "المنافس ليس منتجاً آخر. المنافس جدول بيانات وتقويم على الحائط وذاكرة شخص واحد."
                : "The competitive alternative is not another product. It is a spreadsheet, a wall calendar and one person's memory."}
            </p>
          </div>

          {/* The alert ladder, drawn rather than described */}
          <Card className="self-start">
            <CardContent className="p-6">
              <p className="mb-5 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                {t("alerts.ladder")}
              </p>
              <ol className="space-y-3">
                {ladder.map((days, index) => (
                  <li key={days} className="flex items-center gap-3">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold tabular-nums"
                      style={{
                        backgroundColor: `color-mix(in oklab, var(--color-amber-mid) ${index * 16}%, var(--color-brand-100))`,
                        color: index > 2 ? "#fff" : undefined,
                      }}
                    >
                      {days}
                    </span>
                    <span className="text-sm text-ink-600 dark:text-ink-300">
                      {locale === "ar"
                        ? `${days} يوماً قبل الانتهاء · ${index < 2 ? "بريد" : index < 4 ? "بريد + مدراء" : "بريد + واتساب + تصعيد"}`
                        : `${days} days before expiry · ${index < 2 ? "email" : index < 4 ? "email + managers" : "email + WhatsApp + escalation"}`}
                    </span>
                  </li>
                ))}
                <li className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger-mid text-sm font-semibold text-white">
                    0
                  </span>
                  <span className="text-sm font-medium text-danger-deep dark:text-danger-soft">
                    {locale === "ar" ? "بعد الانتهاء: يومياً حتى الاستلام" : "After expiry: daily until acknowledged"}
                  </span>
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-ink-200 bg-white/60 py-20 dark:border-ink-800 dark:bg-ink-900/30">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title}>
                <feature.icon className="size-5 text-brand-700 dark:text-brand-400" aria-hidden />
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-ink-950 dark:text-ink-50">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The taxonomy, as proof of depth */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-3xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "تصنيف وثائق معدّ يدوياً" : "A hand-curated document taxonomy"}
        </h2>
        <p className="mt-4 max-w-2xl leading-relaxed text-ink-600 dark:text-ink-300">
          {locale === "ar"
            ? "لكل نوع وثيقة: مدة الصلاحية المعتادة، ومهلة التجديد، والجهة المصدرة، وجدول الغرامات، وما ينهار لاحقاً عند انتهائها. مكتوب يدوياً لكل ولاية قضائية — وليس محتوى من المستخدمين."
            : "Every document type carries its typical validity, renewal lead time, issuing authority, penalty schedule and dependency edges. Written by hand per jurisdiction — never user-generated."}
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SEO_DOCUMENT_TYPES.slice(0, 9).map((type) => (
            <Link
              key={type.code}
              href={`/${locale}/guides/${type.seo.slug}`}
              className="group rounded-card border border-ink-200 bg-white p-4 transition-colors hover:border-brand-400 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-brand-600"
            >
              <p className="text-sm font-medium text-ink-900 group-hover:text-brand-800 dark:text-ink-100 dark:group-hover:text-brand-300">
                {locale === "ar" ? type.nameAr : type.nameEn}
              </p>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                {type.jurisdiction === "national" ? type.country : type.jurisdiction} ·{" "}
                {type.typicalValidityMonths
                  ? locale === "ar"
                    ? `${type.typicalValidityMonths} شهراً`
                    : `${type.typicalValidityMonths} months`
                  : locale === "ar"
                    ? "بلا انتهاء"
                    : "no fixed term"}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-8">
        <div className="rounded-card bg-ink-950 px-8 py-14 text-center dark:bg-ink-900">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white">
            {t("marketing.ctaTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-pretty text-ink-300">{t("marketing.ctaBody")}</p>
          <Link href={`/${locale}/sign-up`} className="mt-8 inline-block">
            <Button size="lg">{t("marketing.heroCtaPrimary")}</Button>
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
