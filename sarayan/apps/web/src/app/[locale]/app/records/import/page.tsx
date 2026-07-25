import Link from "next/link";
import { Card, CardContent, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { ImportForm } from "./import-form";

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  await requireSession();

  return (
    <>
      <PageHeader
        title={t("dashboard.importCsv")}
        description={
          locale === "ar"
            ? "ارفع جدولك كما هو. نتعرّف على الأعمدة الشائعة، وننشئ الحاملين تلقائياً، ونخبرك بما لم ننجح فيه."
            : "Upload your spreadsheet as it is. We recognise common column names, create holders automatically, and tell you exactly what we could not read."
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <ImportForm locale={locale} />

        <Card className="self-start">
          <CardContent className="p-5 text-sm">
            <h2 className="font-semibold text-ink-900 dark:text-ink-100">
              {locale === "ar" ? "ما نبحث عنه" : "What we look for"}
            </h2>
            <ul className="mt-3 space-y-1.5 text-ink-600 dark:text-ink-300">
              <li>· {locale === "ar" ? "اسم الحامل (مطلوب)" : "Holder name (required)"}</li>
              <li>· {locale === "ar" ? "تاريخ الانتهاء (مطلوب)" : "Expiry date (required)"}</li>
              <li>· {locale === "ar" ? "نوع الوثيقة" : "Document type"}</li>
              <li>· {locale === "ar" ? "رقم الوثيقة" : "Document number"}</li>
              <li>· {locale === "ar" ? "تاريخ الإصدار" : "Issue date"}</li>
              <li>· {locale === "ar" ? "المنشأة" : "Entity"}</li>
              <li>· {locale === "ar" ? "الجهة المصدرة" : "Issuing authority"}</li>
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
              {locale === "ar"
                ? "نقبل أسماء أعمدة عربية وإنجليزية وصيغاً مختلفة للتواريخ. التواريخ الغامضة مثل 03/04/2026 تُقرأ باليوم أولاً ونعرضها لك للمراجعة."
                : "Arabic and English headers are both recognised, as are mixed date formats. Ambiguous dates like 03/04/2026 are read day-first and listed for you to check."}
            </p>
            <Link
              href="/templates/employee-document-tracker.csv"
              className="mt-4 inline-block text-sm text-brand-700 hover:underline dark:text-brand-400"
            >
              {locale === "ar" ? "تحميل قالب" : "Download a template"}
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
