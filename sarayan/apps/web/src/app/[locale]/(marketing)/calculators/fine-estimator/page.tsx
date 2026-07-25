import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/chrome";
import { FineEstimator } from "@/components/marketing/fine-estimator";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Late document fine estimator — UAE and Saudi Arabia",
  description:
    "Estimate what an expired trade licence, visa, iqama, labour card or vehicle registration is costing you today, using published penalty schedules.",
};

export default async function FineEstimatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { locale: raw } = await params;
  const { type } = await searchParams;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <MarketingShell locale={locale} path="/calculators/fine-estimator">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "حاسبة الغرامات" : "Fine estimator"}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
          {locale === "ar"
            ? "كم تكلّفك وثيقة منتهية اليوم — والخدمات التي تتوقف بسببها."
            : "What an expired document is costing you today — and what it is blocking."}
        </p>

        <div className="mt-10">
          <FineEstimator locale={locale} initialType={type} />
        </div>

        <p className="mt-10 max-w-3xl text-xs leading-relaxed text-ink-400">
          {locale === "ar"
            ? "تقديرات مبنية على الجداول المنشورة وقت الكتابة. الغرامات الفعلية تعتمد على الجهة والإمارة وظروف الحالة. تحقّق قبل الاعتماد."
            : "Estimates based on published schedules at the time of writing. Actual penalties depend on the authority, the emirate and the circumstances of the case. Verify before relying on them."}
        </p>
      </div>
    </MarketingShell>
  );
}
