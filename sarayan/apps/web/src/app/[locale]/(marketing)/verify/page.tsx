import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MarketingShell } from "@/components/marketing/chrome";
import { Button, Card, CardContent, Field, Input } from "@/components/ui";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Verify an evidence pack",
  description:
    "Paste the SHA-256 hash printed on a Sarayan compliance evidence pack to confirm it is authentic and unaltered.",
};

export default async function VerifyIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);

  async function lookup(formData: FormData) {
    "use server";
    const hash = String(formData.get("hash") ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^0-9a-f]/g, "");
    redirect(`/${locale}/verify/${hash}`);
  }

  return (
    <MarketingShell locale={locale} path="/verify">
      <div className="mx-auto max-w-2xl px-4 py-20">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {t("evidence.verifyTitle")}
        </h1>
        <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">{t("evidence.verifyBody")}</p>

        <Card className="mt-8">
          <CardContent className="p-6">
            <form action={lookup} className="space-y-4">
              <Field
                label={locale === "ar" ? "البصمة (SHA-256)" : "Integrity hash (SHA-256)"}
                htmlFor="hash"
                hint={
                  locale === "ar"
                    ? "٦٤ خانة سداسية عشرية، مطبوعة أسفل الوثيقة."
                    : "64 hexadecimal characters, printed at the foot of the document."
                }
              >
                <Input
                  id="hash"
                  name="hash"
                  required
                  dir="ltr"
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono text-xs"
                  placeholder="a3f1c9…"
                />
              </Field>
              <Button type="submit">{t("evidence.verify")}</Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-8 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
          {locale === "ar"
            ? "لا تحتاج إلى حساب. التحقق يعيد حساب البصمة من البيانات المخزّنة ويقارنها — إن تغيّر أي حرف في السجل، لن تتطابق."
            : "No account needed. Verification recomputes the hash from the stored data and compares it — change a single character of the register and it will not match."}
        </p>
      </div>
    </MarketingShell>
  );
}
