import Link from "next/link";
import { Alert, Button, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { formOptions } from "@/lib/queries";
import { can } from "@/lib/rbac";
import { RecordForm } from "../record-form";

export default async function NewRecordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();

  if (!can(session.role, "records.create")) {
    return <Alert tone="danger">{locale === "ar" ? "لا تملك صلاحية إضافة سجلات." : "Your role cannot add records."}</Alert>;
  }

  const options = await formOptions(session.organisation.id);

  if (options.holders.length === 0) {
    return (
      <>
        <PageHeader title={t("records.add")} />
        <Alert tone="info" title={locale === "ar" ? "أضف حاملاً أولاً" : "Add a holder first"}>
          <p className="mt-1">
            {locale === "ar"
              ? "كل سجل يخص شخصاً أو مركبة أو أصلاً أو المنشأة نفسها."
              : "Every record belongs to a person, vehicle, asset, or the entity itself."}
          </p>
          <Link href={`/${locale}/app/holders`} className="mt-3 inline-block">
            <Button size="sm">{locale === "ar" ? "إضافة حامل" : "Add a holder"}</Button>
          </Link>
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("records.add")} />
      <RecordForm locale={locale} options={options} mode="create" />
    </>
  );
}
