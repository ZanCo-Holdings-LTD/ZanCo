import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button, Card, CardContent, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

/**
 * First run.
 *
 * Two routes into a populated register, presented as a choice rather than a
 * wizard. Every design partner arrives with a spreadsheet, so that option comes
 * first — activation depends on ten records existing within the first week, and
 * typing ten records by hand rarely happens.
 */
export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const session = await requireSession();

  const paths = [
    {
      href: `/${locale}/app/records/import`,
      title: locale === "ar" ? "استورد جدولك" : "Import your spreadsheet",
      body:
        locale === "ar"
          ? "ارفع ملف CSV كما هو. نتعرّف على الأعمدة وننشئ الحاملين تلقائياً — هذه أسرع طريقة للوصول إلى سجل حقيقي."
          : "Upload your CSV as it is. We map the columns and create holders for you — the fastest route to a register that is actually complete.",
      primary: true,
    },
    {
      href: `/${locale}/app/holders`,
      title: locale === "ar" ? "ابدأ من الصفر" : "Start from scratch",
      body:
        locale === "ar"
          ? "أضف حاملاً — شخصاً أو مركبة أو مقراً — ثم أضف وثائقه."
          : "Add a holder — a person, a vehicle, a premises — then add their documents.",
      primary: false,
    },
  ];

  return (
    <>
      <PageHeader
        title={
          locale === "ar"
            ? `أهلاً، ${session.user.name.split(" ")[0]}`
            : `Welcome, ${session.user.name.split(" ")[0]}`
        }
        description={
          locale === "ar"
            ? `${session.organisation.name} جاهزة. لنبنِ السجل.`
            : `${session.organisation.name} is set up. Let's build the register.`
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {paths.map((path) => (
          <Link key={path.href} href={path.href}>
            <Card
              className={
                path.primary
                  ? "h-full border-brand-400 transition-colors hover:border-brand-600"
                  : "h-full transition-colors hover:border-ink-300"
              }
            >
              <CardContent className="p-6">
                <h2 className="font-semibold text-ink-950 dark:text-ink-50">{path.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                  {path.body}
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand-700 dark:text-brand-400">
                  {locale === "ar" ? "ابدأ" : "Start"}
                  <ArrowRight className="size-3.5 flip-in-rtl" aria-hidden />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mt-6">
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {locale === "ar" ? "ما يحدث بعد ذلك" : "What happens next"}
          </h2>
          <ol className="mt-3 space-y-2 text-sm text-ink-600 dark:text-ink-300">
            <li>
              1.{" "}
              {locale === "ar"
                ? "كل سجل يحصل على سلّم تنبيهات: ٩٠، ٦٠، ٣٠، ١٤، ٧، ويوم واحد قبل الانتهاء."
                : "Every record gets an alert ladder: 90, 60, 30, 14, 7 and 1 day before expiry."}
            </li>
            <li>
              2.{" "}
              {locale === "ar"
                ? "التنبيهات غير المستلمة تتسع تلقائياً إلى المدراء."
                : "Unacknowledged alerts widen to managers automatically."}
            </li>
            <li>
              3.{" "}
              {locale === "ar"
                ? "في أي لحظة يمكنك إنشاء حزمة إثبات قابلة للتحقق لبنك أو مدقق."
                : "At any point you can generate a verifiable evidence pack for a bank or auditor."}
            </li>
          </ol>
          <Link href={`/${locale}/app`} className="mt-5 inline-block">
            <Button variant="secondary" size="sm">
              {locale === "ar" ? "تخطّي إلى لوحة التحكم" : "Skip to the dashboard"}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
