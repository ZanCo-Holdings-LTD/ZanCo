import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/chrome";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { PUBLIC_PLANS, formatPrice } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Sarayan pricing: Starter £39, Business £99, Enterprise £249 and an Agency tier for PRO firms. Annual billing at two months free, invoice payment available.",
};

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);

  return (
    <MarketingShell locale={locale} path="/pricing">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {t("pricing.title")}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
          {t("pricing.subtitle")}
        </p>

        <div className="mt-12 grid gap-5 lg:grid-cols-4">
          {PUBLIC_PLANS.map((plan) => {
            const featured = plan.tier === "business";
            return (
              <Card
                key={plan.tier}
                className={
                  featured
                    ? "relative border-brand-600 ring-1 ring-brand-600"
                    : undefined
                }
              >
                {featured ? (
                  <Badge tone="brand" className="absolute -top-2.5 start-5">
                    {locale === "ar" ? "الأكثر اختياراً" : "Most chosen"}
                  </Badge>
                ) : null}
                <CardContent className="flex h-full flex-col p-6">
                  <h2 className="text-lg font-semibold text-ink-950 dark:text-ink-50">
                    {locale === "ar" ? plan.nameAr : plan.name}
                  </h2>
                  <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{plan.target}</p>

                  <p className="mt-5 flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold tabular-nums text-ink-950 dark:text-ink-50">
                      {formatPrice(plan.monthlyPence, locale)}
                    </span>
                    <span className="text-sm text-ink-500 dark:text-ink-400">
                      {t("pricing.perMonth")}
                    </span>
                  </p>
                  {plan.perEntityPence ? (
                    <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                      + {formatPrice(plan.perEntityPence, locale)}{" "}
                      {locale === "ar" ? "لكل منشأة عميلة" : "per client entity"}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-brand-700 dark:text-brand-400">
                      {formatPrice(plan.annualPence, locale)} {t("pricing.perYear")} ·{" "}
                      {t("pricing.annualNote")}
                    </p>
                  )}

                  <ul className="mt-6 flex-1 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-brand-400"
                          aria-hidden
                        />
                        <span className="text-ink-700 dark:text-ink-300">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={
                      plan.tier === "agency" || plan.tier === "enterprise"
                        ? `/${locale}/contact?plan=${plan.tier}`
                        : `/${locale}/sign-up?plan=${plan.tier}`
                    }
                    className="mt-7"
                  >
                    <Button variant={featured ? "primary" : "secondary"} className="w-full">
                      {plan.tier === "agency" || plan.tier === "enterprise"
                        ? t("pricing.contact")
                        : t("pricing.choose", { plan: locale === "ar" ? plan.nameAr : plan.name })}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                {locale === "ar" ? "الدفع بالفاتورة" : "Invoice payment"}
              </h3>
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
                {t("pricing.invoiceNote")}{" "}
                {locale === "ar"
                  ? "نُصدر فاتورة تحمل رقمك الضريبي، وتُفعّل الباقة عند تأكيد الحوالة."
                  : "We issue an invoice carrying your VAT number and activate the plan on confirmation of transfer."}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                {locale === "ar" ? "رسائل واتساب" : "WhatsApp messages"}
              </h3>
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
                {locale === "ar"
                  ? "كل باقة تشمل عدداً من رسائل واتساب شهرياً، وما يزيد يُحتسب بالتكلفة. البريد الإلكتروني دائماً غير محدود."
                  : "Each plan includes a monthly WhatsApp allowance; overage is metered at cost. Email is always unlimited."}
              </p>
            </CardContent>
          </Card>
        </div>

        <p className="mt-8 text-sm text-ink-500 dark:text-ink-400">{t("pricing.vatNote")}</p>
      </div>
    </MarketingShell>
  );
}
