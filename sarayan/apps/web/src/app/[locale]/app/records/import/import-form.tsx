"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, CardContent, Field, Input } from "@/components/ui";
import { translator, type Locale } from "@/lib/i18n";
import { importCsvAction } from "./import-action";
import { emptyImportState } from "./import-state";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

export function ImportForm({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, action] = useActionState(importCsvAction, emptyImportState);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <form action={action} className="space-y-4">
            {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

            <Field
              label={locale === "ar" ? "ملف CSV" : "CSV file"}
              htmlFor="file"
              hint={
                locale === "ar"
                  ? "صدّر جدولك كـ CSV من Excel أو Google Sheets."
                  : "Export your spreadsheet as CSV from Excel or Google Sheets."
              }
              required
            >
              <Input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                className="file:me-3 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-ink-800"
              />
            </Field>

            <Submit label={locale === "ar" ? "استيراد" : "Import"} />
          </form>
        </CardContent>
      </Card>

      {state.done ? (
        <Card>
          <CardContent className="p-6">
            <Alert tone={state.imported > 0 ? "success" : "warning"}>
              {locale === "ar"
                ? `استُورد ${state.imported} سجلاً، وأُنشئ ${state.createdHolders} حاملاً، وتُخطّي ${state.skipped}.`
                : `Imported ${state.imported} records, created ${state.createdHolders} holders, skipped ${state.skipped}.`}
            </Alert>

            {state.ambiguousDates.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-amber-deep">
                  {locale === "ar"
                    ? "تواريخ قُرئت باليوم أولاً — تحقّق منها"
                    : "Dates read day-first — please check these"}
                </h3>
                <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                  {locale === "ar"
                    ? "لم يكن ممكناً تحديد أيهما اليوم وأيهما الشهر، فاعتُمد اليوم أولاً."
                    : "Day and month could not be told apart, so day-first was assumed."}
                </p>
                <ul className="mt-3 space-y-1 text-sm">
                  {state.ambiguousDates.map((entry) => (
                    <li key={`${entry.row}-${entry.raw}`} className="text-ink-600 dark:text-ink-300">
                      {locale === "ar" ? "سطر" : "Row"} {entry.row} · {entry.holder} ·{" "}
                      <span dir="ltr" className="font-mono text-xs">
                        {entry.raw} → {entry.resolved}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {state.problems.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">
                  {locale === "ar" ? "ملاحظات" : "Notes"}
                </h3>
                <ul className="mt-2 space-y-1 text-sm text-ink-600 dark:text-ink-300">
                  {state.problems.slice(0, 40).map((problem, index) => (
                    <li key={`${problem.row}-${index}`}>
                      {locale === "ar" ? "سطر" : "Row"} {problem.row}: {problem.message}
                    </li>
                  ))}
                </ul>
                {state.problems.length > 40 ? (
                  <p className="mt-2 text-xs text-ink-400">
                    {locale === "ar"
                      ? `و${state.problems.length - 40} أخرى.`
                      : `And ${state.problems.length - 40} more.`}
                  </p>
                ) : null}
              </div>
            ) : null}

            {state.imported > 0 ? (
              <Link href={`/${locale}/app/records`} className="mt-6 inline-block">
                <Button variant="secondary">{t("records.title")}</Button>
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
