import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/chrome";
import { Button, Card, CardContent } from "@/components/ui";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Employee document tracker template (free CSV)",
  description:
    "A free employee document expiry tracker template for UAE and Saudi companies — the columns that matter, and the four ways a spreadsheet eventually fails.",
};

/**
 * The template page.
 *
 * "Capturing people currently searching for a spreadsheet." The honest move is
 * to actually give them the spreadsheet — a good one — and let the limitations
 * make the argument. The CSV it hands out is the same shape the importer
 * accepts, so the upgrade path is a file upload.
 */
export default async function TemplatePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const columns = [
    ["Holder name", "The person, vehicle or entity the document belongs to"],
    ["Holder type", "person, vehicle, asset or entity"],
    ["Entity", "Which legal entity or branch it sits under"],
    ["Document type", "Trade licence, residence visa, iqama, labour card…"],
    ["Document number", "As printed on the document"],
    ["Issue date", "YYYY-MM-DD, so sorting works"],
    ["Expiry date", "YYYY-MM-DD — the column everything depends on"],
    ["Issuing authority", "Who issued it, for the renewal file"],
    ["Responsible", "The named person who owns the renewal"],
    ["Notes", "Anything the next person needs to know"],
  ];

  const failures = [
    {
      title: locale === "ar" ? "لا أحد يفتحه" : "Nobody opens it",
      body:
        locale === "ar"
          ? "الجدول لا يتصل بك. أنت من عليه أن يتذكر فتحه — وهذا بالضبط ما ينهار في شهر مزدحم."
          : "A spreadsheet cannot contact you. You have to remember to open it, which is precisely what fails in a busy month.",
    },
    {
      title: locale === "ar" ? "التواريخ تُكتب بصيغتين" : "Two date formats, one file",
      body:
        locale === "ar"
          ? "03/04 يعني الثالث من أبريل لشخص، والرابع من مارس لآخر. الفرق شهر كامل من الغرامات."
          : "03/04 is the third of April to one person and the fourth of March to another. The difference is a month of fines.",
    },
    {
      title: locale === "ar" ? "لا يوجد سجل لمن غيّر ماذا" : "No record of who changed what",
      body:
        locale === "ar"
          ? "عندما يسأل المدقق لماذا تغيّر تاريخ انتهاء، لا يملك الجدول إجابة."
          : "When an auditor asks why an expiry date changed, the spreadsheet has no answer.",
    },
    {
      title: locale === "ar" ? "يرحل مع صاحبه" : "It leaves with its owner",
      body:
        locale === "ar"
          ? "الملف على جهاز شخص واحد، وفي رأسه معرفة لم تُكتب في أي عمود."
          : "The file lives on one person's machine, and the knowledge that makes it usable lives in their head.",
    },
  ];

  return (
    <MarketingShell locale={locale} path="/templates/employee-document-tracker">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "قالب متابعة وثائق الموظفين" : "Employee document tracker template"}
        </h1>
        <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
          {locale === "ar"
            ? "قالب مجاني بالأعمدة التي تحتاجها فعلاً. خذه واستخدمه — ثم اقرأ لماذا سيفشل في النهاية."
            : "A free template with the columns that actually matter. Take it and use it — then read why it eventually fails."}
        </p>

        <Card className="mt-8">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <p className="font-medium text-ink-900 dark:text-ink-100">
                {locale === "ar" ? "قالب CSV" : "CSV template"}
              </p>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                {locale === "ar"
                  ? "يفتح في Excel وGoogle Sheets. بترميز UTF-8 حتى تظهر العربية صحيحة."
                  : "Opens in Excel and Google Sheets. UTF-8 with a BOM so Arabic renders correctly."}
              </p>
            </div>
            <a href="/templates/employee-document-tracker.csv" download>
              <Button className="gap-2">
                <Download className="size-4" aria-hidden />
                {locale === "ar" ? "تحميل" : "Download"}
              </Button>
            </a>
          </CardContent>
        </Card>

        <h2 className="mt-14 text-2xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "الأعمدة" : "The columns"}
        </h2>
        <dl className="mt-4 divide-y divide-ink-100 dark:divide-ink-800">
          {columns.map(([name, description]) => (
            <div key={name} className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
              <dt className="font-mono text-sm text-ink-900 dark:text-ink-100">{name}</dt>
              <dd className="text-sm text-ink-600 dark:text-ink-300">{description}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-14 text-2xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "أربع طرق ينهار بها أي جدول" : "Four ways every spreadsheet fails"}
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {failures.map((failure) => (
            <Card key={failure.title}>
              <CardContent className="p-5">
                <h3 className="font-semibold text-ink-900 dark:text-ink-100">{failure.title}</h3>
                <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{failure.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 rounded-card bg-ink-950 p-8 dark:bg-ink-900">
          <h2 className="text-xl font-semibold text-white">
            {locale === "ar" ? "ارفع نفس الملف إلى سريان" : "Upload that same file to Sarayan"}
          </h2>
          <p className="mt-2 max-w-lg text-sm text-ink-300">
            {locale === "ar"
              ? "المستورد يقبل هذا القالب كما هو، ويتعرّف على أعمدة جدولك الحالي أيضاً. أربعة عشر يوماً مجاناً."
              : "The importer accepts this template as-is, and recognises the columns in your existing spreadsheet too. Fourteen days free."}
          </p>
          <Link href={`/${locale}/sign-up`} className="mt-6 inline-block">
            <Button>{locale === "ar" ? "استورد جدولي" : "Import my spreadsheet"}</Button>
          </Link>
        </div>
      </div>
    </MarketingShell>
  );
}
