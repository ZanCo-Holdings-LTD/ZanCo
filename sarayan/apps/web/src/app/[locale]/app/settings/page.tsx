import { asc, count, eq } from "drizzle-orm";
import Link from "next/link";
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { db } from "@/db";
import { memberships, records, users } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { features } from "@/lib/env";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { formatPrice, planFor } from "@/lib/plans";
import { ROLE_LABELS, can } from "@/lib/rbac";
import { removeMemberAction } from "../actions";
import { InviteForm, OrganisationForm, ProfileForm } from "./settings-forms";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();

  const members = await db
    .select({ user: users, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organisationId, session.organisation.id))
    .orderBy(asc(users.name));

  const [{ recordCount }] = await db
    .select({ recordCount: count() })
    .from(records)
    .where(eq(records.organisationId, session.organisation.id));

  const plan = planFor(session.organisation.tier);
  const manageMembers = can(session.role, "members.manage");
  const manageSettings = can(session.role, "settings.manage");

  return (
    <>
      <PageHeader title={t("settings.title")} />

      <div className="grid gap-6 lg:grid-cols-2">
        {manageSettings ? (
          <OrganisationForm
            locale={locale}
            organisation={{
              name: session.organisation.name,
              country: session.organisation.country,
              locale: session.organisation.locale,
              metadataOnlyMode: session.organisation.metadataOnlyMode,
              storageRegion: session.organisation.storageRegion,
              isAgency: session.organisation.isAgency,
            }}
          />
        ) : null}

        <ProfileForm
          locale={locale}
          user={{
            name: session.user.name,
            phone: session.user.phone,
            locale: session.user.locale,
            email: session.user.email,
          }}
        />

        {/* Billing */}
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.billing")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label={locale === "ar" ? "الباقة" : "Plan"}
              value={`${locale === "ar" ? plan.nameAr : plan.name} · ${formatPrice(plan.monthlyPence, locale)}/${locale === "ar" ? "شهر" : "mo"}`}
            />
            <Row
              label={locale === "ar" ? "الحالة" : "Status"}
              value={session.organisation.billingStatus}
            />
            <Row
              label={t("records.title")}
              value={`${recordCount} ${t("common.of")} ${plan.recordLimit === Number.MAX_SAFE_INTEGER ? "∞" : plan.recordLimit}`}
            />
            <Row
              label={locale === "ar" ? "المستخدمون" : "Users"}
              value={`${members.length} ${t("common.of")} ${plan.userLimit === Number.MAX_SAFE_INTEGER ? "∞" : plan.userLimit}`}
            />
            {session.organisation.trialEndsAt ? (
              <Row
                label={locale === "ar" ? "تنتهي التجربة" : "Trial ends"}
                value={session.organisation.trialEndsAt.toISOString().slice(0, 10)}
              />
            ) : null}

            <div className="border-t border-ink-100 pt-3 dark:border-ink-800">
              {features.cardPayments ? (
                <Link
                  href={`/${locale}/app/settings/billing`}
                  className="text-sm text-brand-700 hover:underline dark:text-brand-400"
                >
                  {locale === "ar" ? "إدارة الاشتراك" : "Manage subscription"}
                </Link>
              ) : (
                <p className="text-xs text-ink-500 dark:text-ink-400">
                  {locale === "ar"
                    ? "الدفع بالبطاقة غير مُفعّل على هذا النشر. الفوترة تتم بفاتورة وحوالة بنكية."
                    : "Card payments are not configured on this deployment. Billing runs through invoice and bank transfer."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Members */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("settings.members")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr>
                  <Th>{t("auth.name")}</Th>
                  <Th>{t("auth.email")}</Th>
                  <Th>{t("settings.role")}</Th>
                  {manageMembers ? <Th className="text-end" /> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.user.id}>
                    <Td className="font-medium text-ink-900 dark:text-ink-100">
                      {member.user.name}
                      {member.user.id === session.user.id ? (
                        <span className="ms-2 text-xs text-ink-400">
                          ({locale === "ar" ? "أنت" : "you"})
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-ink-500 dark:text-ink-400" dir="ltr">
                      {member.user.email}
                    </Td>
                    <Td>
                      <Badge tone={member.role === "owner" ? "brand" : "neutral"}>
                        {locale === "ar" ? ROLE_LABELS[member.role].ar : ROLE_LABELS[member.role].en}
                      </Badge>
                      <p className="mt-1 text-xs text-ink-400">
                        {ROLE_LABELS[member.role].description}
                      </p>
                    </Td>
                    {manageMembers ? (
                      <Td className="text-end">
                        {member.user.id !== session.user.id && member.role !== "owner" ? (
                          <form action={removeMemberAction}>
                            <input type="hidden" name="userId" value={member.user.id} />
                            <button
                              type="submit"
                              className="text-xs text-ink-400 hover:text-danger-deep"
                            >
                              {t("settings.remove")}
                            </button>
                          </form>
                        ) : null}
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>

            {manageMembers ? (
              <div className="mt-5 border-t border-ink-100 pt-5 dark:border-ink-800">
                <InviteForm locale={locale} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Integration status — honest about what is and is not configured */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{locale === "ar" ? "حالة التكاملات" : "Integration status"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                label: locale === "ar" ? "استخراج الوثائق" : "Document extraction",
                on: features.extraction,
                offNote: locale === "ar" ? "إدخال يدوي" : "manual entry",
              },
              {
                label: locale === "ar" ? "البريد الإلكتروني" : "Email delivery",
                on: features.email,
                offNote: locale === "ar" ? "تنبيهات داخل التطبيق فقط" : "in-app alerts only",
              },
              {
                label: "WhatsApp",
                on: features.whatsapp,
                offNote: locale === "ar" ? "غير مُفعّل" : "not configured",
              },
              {
                label: locale === "ar" ? "الدفع بالبطاقة" : "Card payments",
                on: features.cardPayments,
                offNote: locale === "ar" ? "فوترة يدوية" : "manual invoicing",
              },
              {
                label: locale === "ar" ? "تخزين الكائنات" : "Object storage",
                on: features.objectStorage,
                offNote: locale === "ar" ? "تخزين محلي" : "local filesystem",
              },
            ].map((integration) => (
              <div key={integration.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-700 dark:text-ink-300">{integration.label}</span>
                <Badge tone={integration.on ? "valid" : "neutral"}>
                  {integration.on
                    ? locale === "ar"
                      ? "مُفعّل"
                      : "on"
                    : integration.offNote}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {session.organisation.metadataOnlyMode ? (
          <Alert tone="info" className="lg:col-span-2">
            {t("settings.metadataOnlyBody")}
          </Alert>
        ) : null}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-500 dark:text-ink-400">{label}</span>
      <span className="text-end font-medium text-ink-800 dark:text-ink-200">{value}</span>
    </div>
  );
}
