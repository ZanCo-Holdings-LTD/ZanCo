import { KeyRound, Lock, MapPin, ScrollText, ShieldCheck, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/chrome";
import { Card, CardContent } from "@/components/ui";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Security and data protection",
  description:
    "How Sarayan protects passports, Emirates IDs and iqamas: per-tenant encryption keys, regional hosting, PDPL alignment, a DPA and a metadata-only mode.",
};

/**
 * The security page.
 *
 * "This costs a weekend and unblocks buyers who would otherwise stall for
 * months." Storing passports and national IDs is the second-most-severe risk in
 * the brief; this page is the mitigation, and it is deliberately specific
 * rather than reassuring.
 */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const controls = [
    {
      icon: KeyRound,
      title: locale === "ar" ? "مفاتيح تشفير لكل عميل" : "Per-tenant encryption keys",
      body:
        locale === "ar"
          ? "كل مؤسسة لها مفتاح بيانات خاص بها، مغلّف بمفتاح رئيسي. الملفات تُشفّر قبل مغادرتها الخادم، فلا يحتفظ مخزن الكائنات بأي مستند قابل للقراءة."
          : "Every organisation has its own data key, wrapped by a master key. Files are encrypted with AES-256-GCM before they leave the application, so the object store never holds a readable document.",
    },
    {
      icon: MapPin,
      title: locale === "ar" ? "استضافة إقليمية" : "Region-pinned storage",
      body:
        locale === "ar"
          ? "الملفات تُخزّن في المنطقة المحددة لحسابك، والافتراضي me-central-1. إذا تطلّب عميل استضافة داخل الدولة، هناك مسار ترحيل موثّق."
          : "Files are stored in the region pinned to your account, defaulting to me-central-1. If a customer requires in-country hosting there is a documented migration path rather than a promise.",
    },
    {
      icon: Trash2,
      title: locale === "ar" ? "وضع البيانات الوصفية فقط" : "Metadata-only mode",
      body:
        locale === "ar"
          ? "تابع التواريخ والأرقام دون رفع أي ملف. تحصل على التنبيهات وحزم الإثبات، وتبقى جوازات السفر والهويات لديك."
          : "Track dates and numbers without uploading a single file. You still get the alert ladder and the evidence packs; the passports and IDs stay on your side of the line.",
    },
    {
      icon: ScrollText,
      title: locale === "ar" ? "سجل تدقيق كامل" : "Full audit trail",
      body:
        locale === "ar"
          ? "كل تغيير في تاريخ انتهاء، وكل استلام تنبيه، وكل حزمة إثبات مُنشأة تُسجّل مع الفاعل والوقت وعنوان الشبكة."
          : "Every expiry-date change, alert acknowledgement and generated evidence pack is written to an append-only log with actor, timestamp and IP address.",
    },
    {
      icon: Lock,
      title: locale === "ar" ? "ضوابط الوصول" : "Access controls",
      body:
        locale === "ar"
          ? "أربعة أدوار: مالك، مدير، مشرف، مشاهد. الصلاحيات تُفرض على الخادم في كل عملية، وليس في الواجهة فقط."
          : "Four roles — owner, admin, manager, viewer. Permissions are enforced server-side on every mutation, not merely hidden in the interface.",
    },
    {
      icon: ShieldCheck,
      title: locale === "ar" ? "التوافق مع نظام حماية البيانات" : "PDPL and GDPR alignment",
      body:
        locale === "ar"
          ? "اتفاقية معالجة بيانات جاهزة للتوقيع، وقائمة معالجين فرعيين منشورة، وموقف موثّق من مكان تخزين البيانات."
          : "A data processing agreement ready to sign, a published subprocessor list, and a documented residency position — the three things a Gulf buyer's legal team asks for before signature.",
    },
  ];

  return (
    <MarketingShell locale={locale} path="/security">
      <div className="mx-auto max-w-4xl px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
          {locale === "ar" ? "الأمان وحماية البيانات" : "Security and data protection"}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
          {locale === "ar"
            ? "نطلب منك تخزين جوازات سفر وهويات موظفيك. هذه الصفحة تشرح بالتحديد كيف نحميها."
            : "We are asking you to store your employees' passports and national IDs. This page states specifically how they are protected."}
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {controls.map((control) => (
            <Card key={control.title}>
              <CardContent className="p-6">
                <control.icon className="size-5 text-brand-700 dark:text-brand-400" aria-hidden />
                <h2 className="mt-3 font-semibold text-ink-950 dark:text-ink-50">{control.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                  {control.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <section className="prose-sarayan mt-14 text-ink-700 dark:text-ink-300">
          <h2>{locale === "ar" ? "ما لا نفعله" : "What we do not do"}</h2>
          <ul>
            <li>
              {locale === "ar"
                ? "لا نستخدم مستنداتك لتدريب أي نموذج ذكاء اصطناعي."
                : "We do not use your documents to train any AI model."}
            </li>
            <li>
              {locale === "ar"
                ? "لا نبيع بياناتك ولا نشاركها مع معلنين."
                : "We do not sell your data or share it with advertisers."}
            </li>
            <li>
              {locale === "ar"
                ? "لا ندع نموذجاً يقرر ما إذا كنت ملتزماً. الاستخراج فقط يستخدم الذكاء الاصطناعي؛ التواريخ والتنبيهات ومنطق الالتزام كلها شيفرة محدّدة."
                : "We do not let a model decide whether you are compliant. AI does extraction and classification only — dates, alerts and compliance logic are deterministic code."}
            </li>
          </ul>

          <h2>{locale === "ar" ? "الإبلاغ عن ثغرة" : "Reporting a vulnerability"}</h2>
          <p>
            {locale === "ar"
              ? "أرسل التفاصيل إلى security@sarayan.app. نردّ خلال يومي عمل، ولن نتخذ أي إجراء قانوني ضد بحث أمني حسن النية."
              : "Send details to security@sarayan.app. We respond within two working days and will not pursue legal action against good-faith security research."}
          </p>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href={`/${locale}/legal/dpa`}
            className="text-sm text-brand-700 hover:underline dark:text-brand-400"
          >
            {locale === "ar" ? "اتفاقية معالجة البيانات" : "Data processing agreement"}
          </Link>
          <Link
            href={`/${locale}/legal/subprocessors`}
            className="text-sm text-brand-700 hover:underline dark:text-brand-400"
          >
            {locale === "ar" ? "قائمة المعالجين الفرعيين" : "Subprocessor list"}
          </Link>
          <Link
            href={`/${locale}/legal/privacy`}
            className="text-sm text-brand-700 hover:underline dark:text-brand-400"
          >
            {locale === "ar" ? "سياسة الخصوصية" : "Privacy policy"}
          </Link>
        </div>
      </div>
    </MarketingShell>
  );
}
