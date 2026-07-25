import { CalendarRange, Coins, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/chrome";
import { Card, CardContent } from "@/components/ui";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Compliance calculators for the UAE and Saudi Arabia",
  description:
    "Estimate late renewal fines, budget annual renewal costs, and plan visa timelines across the UAE and Saudi Arabia.",
};

export default async function CalculatorsIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const calculators = [
    {
      href: `/${locale}/calculators/fine-estimator`,
      icon: Receipt,
      title: locale === "ar" ? "حاسبة الغرامات" : "Fine estimator",
      body:
        locale === "ar"
          ? "كم تكلّف وثيقة متأخرة اليوم، حسب الجداول المنشورة."
          : "What a late document is costing you today, against the published schedules.",
    },
    {
      href: `/${locale}/calculators/renewal-cost`,
      icon: Coins,
      title: locale === "ar" ? "حاسبة تكلفة التجديد" : "Renewal cost calculator",
      body:
        locale === "ar"
          ? "ميزانية التجديدات السنوية لفريقك وأسطولك ومنشآتك."
          : "Budget a year of renewals across your staff, fleet and premises.",
    },
    {
      href: `/${locale}/calculators/visa-timeline`,
      icon: CalendarRange,
      title: locale === "ar" ? "حاسبة الجدول الزمني للتأشيرة" : "Visa timeline calculator",
      body:
        locale === "ar"
          ? "متى تبدأ التجديد حتى لا يعمل أحد بتأشيرة منتهية."
          : "When to start, so nobody is working on an expired visa.",
    },
  ];

  return (
    <MarketingShell locale={locale} path="/calculators">
      <div className="mx-auto max-w-4xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "الحاسبات" : "Calculators"}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
          {locale === "ar"
            ? "تعمل على الجداول المعدّة يدوياً نفسها التي يستخدمها المنتج."
            : "They run on the same hand-curated schedules the product itself uses."}
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {calculators.map((calculator) => (
            <Link key={calculator.href} href={calculator.href}>
              <Card className="h-full transition-colors hover:border-brand-400 dark:hover:border-brand-600">
                <CardContent className="p-6">
                  <calculator.icon className="size-5 text-brand-700 dark:text-brand-400" aria-hidden />
                  <h2 className="mt-3 font-semibold text-ink-950 dark:text-ink-50">
                    {calculator.title}
                  </h2>
                  <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{calculator.body}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </MarketingShell>
  );
}
