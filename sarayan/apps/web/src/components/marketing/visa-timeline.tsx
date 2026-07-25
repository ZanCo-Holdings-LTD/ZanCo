"use client";

import { addDays, daysBetween, today } from "@sarayan/core-watch";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, CardContent, Field, Input, Select } from "@/components/ui";
import { DOCUMENT_TYPES, documentType } from "@/content/taxonomy";
import type { Locale } from "@/lib/i18n";

/**
 * Visa timeline calculator.
 *
 * Works backwards from the expiry date through the real sequence — medical,
 * biometrics, stamping — rather than quoting one lead-time number, because the
 * question people actually have is "when do I need to start".
 */

interface Stage {
  key: string;
  labelEn: string;
  labelAr: string;
  /** Working days this stage typically consumes. */
  days: number;
}

const STAGES: Record<string, Stage[]> = {
  AE_RESIDENCE_VISA: [
    { key: "prep", labelEn: "Passport check, photos, insurance", labelAr: "فحص الجواز والصور والتأمين", days: 14 },
    { key: "medical", labelEn: "Medical fitness test and results", labelAr: "الفحص الطبي والنتائج", days: 7 },
    { key: "biometrics", labelEn: "Emirates ID biometrics", labelAr: "بصمة الهوية الإماراتية", days: 5 },
    { key: "stamping", labelEn: "Visa stamping and issue", labelAr: "ختم التأشيرة وإصدارها", days: 7 },
    { key: "buffer", labelEn: "Buffer for rejections and re-submission", labelAr: "هامش للرفض وإعادة التقديم", days: 14 },
  ],
  SA_IQAMA: [
    { key: "insurance", labelEn: "Medical insurance renewal", labelAr: "تجديد التأمين الطبي", days: 10 },
    { key: "gosi", labelEn: "GOSI contributions reconciled", labelAr: "تسوية اشتراكات التأمينات", days: 7 },
    { key: "levy", labelEn: "Levy payment", labelAr: "سداد المقابل المالي", days: 3 },
    { key: "filing", labelEn: "Filing through Absher / Muqeem", labelAr: "التقديم عبر أبشر ومقيم", days: 3 },
    { key: "buffer", labelEn: "Buffer for blocked obligations", labelAr: "هامش للالتزامات المعلّقة", days: 14 },
  ],
  SA_WORK_PERMIT: [
    { key: "nitaqat", labelEn: "Confirm Nitaqat band in Qiwa", labelAr: "التحقق من نطاق قوى", days: 5 },
    { key: "levy", labelEn: "Labour levy payment", labelAr: "سداد رسوم العمل", days: 3 },
    { key: "filing", labelEn: "Permit renewal filing", labelAr: "تقديم تجديد الرخصة", days: 5 },
    { key: "buffer", labelEn: "Buffer", labelAr: "هامش", days: 14 },
  ],
};

const SUPPORTED = Object.keys(STAGES);

export function VisaTimelineCalculator({ locale }: { locale: Locale }) {
  const [code, setCode] = useState(SUPPORTED[0]);
  const [expiryDate, setExpiryDate] = useState(addDays(today(), 120));

  const stages = useMemo(() => STAGES[code] ?? [], [code]);
  const totalDays = stages.reduce((sum, stage) => sum + stage.days, 0);

  const schedule = useMemo(() => {
    if (!expiryDate) return [];
    let cursor = expiryDate;
    // Walk backwards from expiry so each stage's deadline is explicit.
    return [...stages]
      .reverse()
      .map((stage) => {
        const endsOn = cursor;
        cursor = addDays(cursor, -stage.days);
        return { ...stage, startsOn: cursor, endsOn };
      })
      .reverse();
  }, [expiryDate, stages]);

  const startOn = schedule[0]?.startsOn ?? expiryDate;
  const daysUntilStart = expiryDate ? daysBetween(today(), startOn) : 0;
  const type = documentType(code);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label={locale === "ar" ? "نوع الوثيقة" : "Document type"} htmlFor="visa-type">
            <Select id="visa-type" value={code} onChange={(event) => setCode(event.target.value)}>
              {SUPPORTED.map((supported) => {
                const entry = DOCUMENT_TYPES.find((candidate) => candidate.code === supported);
                if (!entry) return null;
                return (
                  <option key={supported} value={supported}>
                    {locale === "ar" ? entry.nameAr : entry.nameEn}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label={locale === "ar" ? "تاريخ الانتهاء" : "Expiry date"} htmlFor="visa-expiry">
            <Input
              id="visa-expiry"
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card
        className={
          daysUntilStart < 0 ? "border-danger-mid/40 bg-danger-soft/40 dark:bg-danger-deep/10" : undefined
        }
      >
        <CardContent className="p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {locale === "ar" ? "ابدأ في" : "Start on"}
          </p>
          <p
            className={`mt-2 text-3xl font-semibold tabular-nums ${
              daysUntilStart < 0 ? "text-danger-deep" : "text-ink-950 dark:text-ink-50"
            }`}
          >
            {startOn}
          </p>
          <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
            {daysUntilStart < 0
              ? locale === "ar"
                ? `كان يجب أن تبدأ قبل ${Math.abs(daysUntilStart)} يوماً. ابدأ اليوم.`
                : `You should have started ${Math.abs(daysUntilStart)} days ago. Start today.`
              : locale === "ar"
                ? `بعد ${daysUntilStart} يوماً من اليوم · ${totalDays} يوماً إجمالاً`
                : `${daysUntilStart} days from today · ${totalDays} days end to end`}
          </p>

          <ol className="mt-6 space-y-0">
            {schedule.map((stage, index) => (
              <li key={stage.key} className="relative flex gap-4 pb-6 last:pb-0">
                {index < schedule.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute start-[11px] top-6 h-full w-px bg-ink-200 dark:bg-ink-700"
                  />
                ) : null}
                <span className="relative z-10 mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                    {locale === "ar" ? stage.labelAr : stage.labelEn}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-ink-500 dark:text-ink-400">
                    {stage.startsOn} → {stage.endsOn} · {stage.days}{" "}
                    {locale === "ar" ? "يوماً" : "days"}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {type ? (
            <p className="mt-4 border-t border-ink-100 pt-4 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
              {locale === "ar"
                ? `المهلة الافتراضية في سريان لهذا النوع: ${type.renewalLeadDays} يوماً.`
                : `Sarayan's default lead time for this type is ${type.renewalLeadDays} days.`}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Link href={`/${locale}/sign-up`}>
        <Button>
          {locale === "ar" ? "احصل على تذكير قبل هذا التاريخ" : "Get reminded before that date"}
        </Button>
      </Link>
    </div>
  );
}
