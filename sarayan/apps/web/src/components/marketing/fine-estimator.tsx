"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, CardContent, Field, Input, Select } from "@/components/ui";
import { DOCUMENT_TYPES, estimatePenalty } from "@/content/taxonomy";
import type { Locale } from "@/lib/i18n";

/**
 * The fine estimator.
 *
 * A link magnet, and the sales argument in one interaction: "lead every sales
 * conversation with the fine schedule, not the feature list." It runs entirely
 * client-side against the same `estimatePenalty` the product uses, so the
 * number a prospect sees here is the number they see after signing up.
 */
export function FineEstimator({ locale, initialType }: { locale: Locale; initialType?: string }) {
  const withPenalties = useMemo(
    () => DOCUMENT_TYPES.filter((type) => type.penalties.length > 0),
    [],
  );

  const [code, setCode] = useState(initialType ?? withPenalties[0]?.code ?? "");
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState(1);

  const daysLate = useMemo(() => {
    if (!expiryDate) return 0;
    const expiry = Date.parse(`${expiryDate}T00:00:00Z`);
    if (Number.isNaN(expiry)) return 0;
    const todayUtc = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    return Math.max(0, Math.round((todayUtc - expiry) / 86_400_000));
  }, [expiryDate]);

  const type = withPenalties.find((entry) => entry.code === code);
  const estimate = code ? estimatePenalty(code, daysLate) : null;
  const total = estimate ? estimate.amount * Math.max(1, quantity) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <Card>
        <CardContent className="space-y-4 p-6">
          <Field label={locale === "ar" ? "نوع الوثيقة" : "Document type"} htmlFor="type">
            <Select id="type" value={code} onChange={(event) => setCode(event.target.value)}>
              {withPenalties.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {locale === "ar" ? entry.nameAr : entry.nameEn} (
                  {entry.jurisdiction === "national" ? entry.country : entry.jurisdiction})
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={locale === "ar" ? "تاريخ الانتهاء" : "Expiry date"}
            htmlFor="expiry"
            hint={locale === "ar" ? "التاريخ المطبوع على الوثيقة" : "The date printed on the document"}
          >
            <Input
              id="expiry"
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
          </Field>

          <Field
            label={locale === "ar" ? "عدد الوثائق" : "How many documents"}
            htmlFor="quantity"
            hint={
              locale === "ar"
                ? "الغرامات لكل شخص أو مركبة تتضاعف بسرعة."
                : "Per-person and per-vehicle penalties multiply quickly."
            }
          >
            <Input
              id="quantity"
              type="number"
              min={1}
              max={500}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value) || 1)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card
        className={
          total > 0 ? "border-danger-mid/40 bg-danger-soft/40 dark:bg-danger-deep/10" : undefined
        }
      >
        <CardContent className="p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {locale === "ar" ? "الغرامة التقديرية اليوم" : "Estimated penalty today"}
          </p>

          {!expiryDate ? (
            <p className="mt-4 text-sm text-ink-500 dark:text-ink-400">
              {locale === "ar"
                ? "أدخل تاريخ الانتهاء لرؤية التقدير."
                : "Enter an expiry date to see the estimate."}
            </p>
          ) : daysLate === 0 ? (
            <>
              <p className="mt-3 text-3xl font-semibold text-brand-700 dark:text-brand-400">
                {locale === "ar" ? "لم تنتهِ بعد" : "Not yet expired"}
              </p>
              <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">
                {locale === "ar"
                  ? `ابدأ التجديد قبل ${type?.renewalLeadDays ?? 30} يوماً من تاريخ الانتهاء.`
                  : `Start the renewal ${type?.renewalLeadDays ?? 30} days before the expiry date.`}
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-4xl font-semibold tabular-nums text-danger-deep dark:text-danger-mid">
                {estimate ? `${estimate.currency} ${total.toLocaleString()}` : "—"}
              </p>
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
                {locale === "ar"
                  ? `متأخرة ${daysLate} يوماً${quantity > 1 ? ` × ${quantity} وثيقة` : ""}`
                  : `${daysLate} days late${quantity > 1 ? ` × ${quantity} documents` : ""}`}
              </p>

              {estimate ? (
                <ul className="mt-4 space-y-1 border-t border-ink-200/70 pt-4 text-sm text-ink-600 dark:border-ink-700 dark:text-ink-300">
                  {estimate.breakdown.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}

              {type && type.consequences.length > 0 ? (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                    {locale === "ar" ? "وهذا ليس كل شيء" : "And the fine is not the worst part"}
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-ink-700 dark:text-ink-300">
                    {type.consequences.map((consequence) => (
                      <li key={consequence.effect}>· {consequence.effect}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}

          <Link href={`/${locale}/sign-up`} className="mt-6 inline-block">
            <Button>{locale === "ar" ? "تتبّع هذا تلقائياً" : "Track this automatically"}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
