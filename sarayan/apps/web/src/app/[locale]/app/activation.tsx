import { Check, Circle } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui";
import { translator, type Locale } from "@/lib/i18n";

/**
 * The activation checklist.
 *
 * "Activation: 10+ records added and one alert acknowledged within 7 days."
 * That definition is the product's retention hinge, so it is shown to the
 * customer as a checklist rather than tracked silently in an analytics tool —
 * the fastest way to move a metric is to tell people what it is.
 *
 * It disappears once activated, so it is onboarding rather than clutter.
 */
export function ActivationChecklist({
  locale,
  recordCount,
  acknowledged,
  entityConfigured,
}: {
  locale: Locale;
  recordCount: number;
  acknowledged: number;
  entityConfigured: boolean;
}) {
  const t = translator(locale);
  const activated = recordCount >= 10 && acknowledged >= 1;
  if (activated) return null;

  const steps = [
    {
      done: entityConfigured || recordCount > 0,
      label: locale === "ar" ? "أضف أول سجل" : "Add your first record",
      href: `/${locale}/app/records/new`,
    },
    {
      done: recordCount >= 10,
      label:
        locale === "ar"
          ? `أضف ١٠ سجلات (${recordCount}/10)`
          : `Add 10 records (${recordCount}/10)`,
      href: `/${locale}/app/records/import`,
    },
    {
      done: acknowledged >= 1,
      label: locale === "ar" ? "استلم تنبيهاً واحداً" : "Acknowledge one alert",
      href: `/${locale}/app/alerts`,
    },
  ];

  return (
    <Card className="mt-4 border-brand-300 bg-brand-50/60 dark:border-brand-800 dark:bg-brand-900/20">
      <CardContent className="p-5">
        <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">
          {t("dashboard.activationTitle")}
        </p>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
          {t("dashboard.activationBody")}
        </p>
        <ul className="mt-4 space-y-2">
          {steps.map((step) => (
            <li key={step.label}>
              <Link
                href={step.href}
                className="flex items-center gap-2.5 text-sm text-ink-700 hover:text-ink-950 dark:text-ink-300 dark:hover:text-ink-50"
              >
                {step.done ? (
                  <Check className="size-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
                ) : (
                  <Circle className="size-4 shrink-0 text-ink-300" aria-hidden />
                )}
                <span className={step.done ? "text-ink-400 line-through" : undefined}>
                  {step.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
