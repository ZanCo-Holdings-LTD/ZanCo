import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/chrome";
import { RenewalCostCalculator } from "@/components/marketing/renewal-cost";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Annual renewal cost calculator — UAE and Saudi Arabia",
  description:
    "Budget a year of government document renewals across your staff, fleet and premises in the UAE or Saudi Arabia.",
};

export default async function RenewalCostPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <MarketingShell locale={locale} path="/calculators/renewal-cost">
      <div className="mx-auto max-w-4xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "حاسبة تكلفة التجديد" : "Renewal cost calculator"}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
          {locale === "ar"
            ? "ما ستدفعه هذا العام على التجديدات الحكومية — قبل أي غرامة."
            : "What a year of government renewals will cost you — before a single fine."}
        </p>
        <div className="mt-10">
          <RenewalCostCalculator locale={locale} />
        </div>
        <p className="mt-10 text-xs leading-relaxed text-ink-400">
          {locale === "ar"
            ? "تقديرات مبنية على الرسوم الرسمية المنشورة، ولا تشمل رسوم مكاتب الخدمة أو التأمين الطبي أو رسوم مراكز الطباعة."
            : "Estimates based on published official fees. They exclude PRO service charges, medical insurance and typing centre fees."}
        </p>
      </div>
    </MarketingShell>
  );
}
