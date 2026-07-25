import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/chrome";
import { VisaTimelineCalculator } from "@/components/marketing/visa-timeline";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Visa and iqama renewal timeline calculator",
  description:
    "Work backwards from a UAE residence visa or Saudi iqama expiry date to the day you need to start, stage by stage.",
};

export default async function VisaTimelinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <MarketingShell locale={locale} path="/calculators/visa-timeline">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "حاسبة الجدول الزمني للتأشيرة" : "Visa timeline calculator"}
        </h1>
        <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
          {locale === "ar"
            ? "من تاريخ الانتهاء إلى الوراء، مرحلة بمرحلة، حتى اليوم الذي يجب أن تبدأ فيه."
            : "From the expiry date backwards, stage by stage, to the day you need to start."}
        </p>
        <div className="mt-10">
          <VisaTimelineCalculator locale={locale} />
        </div>
      </div>
    </MarketingShell>
  );
}
