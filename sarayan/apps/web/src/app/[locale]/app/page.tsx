import { addDays, daysBetween, today } from "@sarayan/core-watch";
import { ArrowUpRight, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { and, count, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  StatusDot,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { db } from "@/db";
import { alerts, entities, holders, records } from "@/db/schema";
import { documentTypeName, estimatePenalty } from "@/content/taxonomy";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, formatDate, isLocale, translator, type Locale } from "@/lib/i18n";
import { daysRemaining } from "@/lib/records";
import { ActivationChecklist } from "./activation";

/**
 * The dashboard.
 *
 * Answers job-to-be-done #1 — "tell me what is expiring in the next 90 days
 * across everything I am responsible for" — above the fold, before anything
 * else. The north star metric (records under active monitoring) is shown to the
 * customer too, not just tracked internally: it is the number that tells them
 * whether the register is real.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);

  const session = await requireSession();
  const organisationId = session.organisation.id;
  const asOf = today();
  const horizon = addDays(asOf, 90);

  // Status counts in one pass rather than five round trips.
  const [summary] = await db
    .select({
      total: count(),
      monitored: sql<number>`count(*) filter (where ${records.noExpiry} = false and ${records.archivedAt} is null)`,
      valid: sql<number>`count(*) filter (where ${records.status} = 'valid')`,
      dueSoon: sql<number>`count(*) filter (where ${records.status} = 'due_soon')`,
      critical: sql<number>`count(*) filter (where ${records.status} = 'critical')`,
      expired: sql<number>`count(*) filter (where ${records.status} = 'expired')`,
    })
    .from(records)
    .where(and(eq(records.organisationId, organisationId), isNull(records.archivedAt)));

  const [alertStats] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${alerts.sentAt} is not null)`,
      acknowledged: sql<number>`count(*) filter (where ${alerts.acknowledgedAt} is not null)`,
      waiting: sql<number>`count(*) filter (where ${alerts.status} = 'sent' and ${alerts.acknowledgedAt} is null)`,
    })
    .from(alerts)
    .where(eq(alerts.organisationId, organisationId));

  const upcoming = await db
    .select({
      id: records.id,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      expiresOn: records.expiresOn,
      status: records.status,
      holderName: holders.name,
      holderKind: holders.kind,
      entityName: entities.name,
    })
    .from(records)
    .innerJoin(holders, eq(holders.id, records.holderId))
    .innerJoin(entities, eq(entities.id, records.entityId))
    .where(
      and(
        eq(records.organisationId, organisationId),
        isNull(records.archivedAt),
        isNotNull(records.expiresOn),
        lte(records.expiresOn, horizon),
      ),
    )
    .orderBy(records.expiresOn)
    .limit(25);

  // Penalty exposure across everything already expired — the number that makes
  // the case for the product in one figure.
  const expiredRecords = await db
    .select({ documentTypeCode: records.documentTypeCode, expiresOn: records.expiresOn })
    .from(records)
    .where(
      and(
        eq(records.organisationId, organisationId),
        eq(records.status, "expired"),
        isNotNull(records.documentTypeCode),
      ),
    );

  const exposure = new Map<string, number>();
  for (const record of expiredRecords) {
    if (!record.documentTypeCode || !record.expiresOn) continue;
    const late = Math.max(0, daysBetween(record.expiresOn, asOf));
    const penalty = estimatePenalty(record.documentTypeCode, late);
    if (penalty) exposure.set(penalty.currency, (exposure.get(penalty.currency) ?? 0) + penalty.amount);
  }

  const acknowledgementRate =
    alertStats.sent > 0 ? Math.round((alertStats.acknowledged / alertStats.sent) * 100) : null;

  return (
    <>
      <PageHeader
        title={t("dashboard.title")}
        description={session.organisation.name}
        action={
          <div className="flex gap-2">
            <Link href={`/${locale}/app/records/import`}>
              <Button variant="secondary" className="gap-2">
                <Upload className="size-4" aria-hidden />
                {t("dashboard.importCsv")}
              </Button>
            </Link>
            <Link href={`/${locale}/app/records/new`}>
              <Button className="gap-2">
                <Plus className="size-4" aria-hidden />
                {t("dashboard.addRecord")}
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("dashboard.northStar")}
          value={String(summary.monitored)}
          hint={locale === "ar" ? "المؤشر الأساسي" : "North star"}
        />
        <Stat
          label={t("dashboard.expiringSoon")}
          value={String(Number(summary.dueSoon) + Number(summary.critical))}
          tone={Number(summary.critical) > 0 ? "warning" : undefined}
        />
        <Stat
          label={t("dashboard.expired")}
          value={String(summary.expired)}
          tone={Number(summary.expired) > 0 ? "danger" : undefined}
        />
        <Stat
          label={t("dashboard.acknowledgementRate")}
          value={acknowledgementRate === null ? "—" : `${acknowledgementRate}%`}
          hint={
            alertStats.waiting > 0
              ? locale === "ar"
                ? `${alertStats.waiting} بانتظار الاستلام`
                : `${alertStats.waiting} waiting`
              : undefined
          }
        />
      </div>

      {exposure.size > 0 ? (
        <Card className="mt-4 border-danger-mid/40 bg-danger-soft/40 dark:bg-danger-deep/10">
          <CardContent className="flex flex-wrap items-baseline justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-danger-deep">
                {t("dashboard.exposure")}
              </p>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
                {locale === "ar"
                  ? `عبر ${expiredRecords.length} وثيقة منتهية`
                  : `Across ${expiredRecords.length} expired document${expiredRecords.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <p className="text-2xl font-semibold tabular-nums text-danger-deep dark:text-danger-mid">
              {[...exposure.entries()]
                .map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`)
                .join(" · ")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <ActivationChecklist
        locale={locale}
        recordCount={Number(summary.total)}
        acknowledged={Number(alertStats.acknowledged)}
        entityConfigured={Number(summary.total) > 0}
      />

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {t("dashboard.greeting")}
          </h2>
          <Link
            href={`/${locale}/app/records`}
            className="flex items-center gap-1 text-sm text-brand-700 hover:underline dark:text-brand-400"
          >
            {t("records.title")}
            <ArrowUpRight className="size-3.5 flip-in-rtl" aria-hidden />
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <EmptyState
            title={
              Number(summary.total) === 0
                ? t("dashboard.empty")
                : locale === "ar"
                  ? "لا شيء ينتهي خلال ٩٠ يوماً."
                  : "Nothing expires in the next 90 days."
            }
            body={
              Number(summary.total) === 0
                ? undefined
                : locale === "ar"
                  ? "وهذا بالضبط ما يفترض أن تبدو عليه هذه الصفحة."
                  : "Which is exactly what this page is supposed to look like."
            }
            action={
              Number(summary.total) === 0 ? (
                <Link href={`/${locale}/app/records/new`}>
                  <Button>{t("dashboard.addRecord")}</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <thead>
                  <tr>
                    <Th>{t("records.holder")}</Th>
                    <Th>{t("records.documentType")}</Th>
                    <Th>{t("records.entity")}</Th>
                    <Th>{t("records.expires")}</Th>
                    <Th className="text-end">{t("records.status")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((record) => {
                    const remaining = daysRemaining(record.expiresOn);
                    return (
                      <tr key={record.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                        <Td>
                          <Link
                            href={`/${locale}/app/records/${record.id}`}
                            className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100 dark:hover:text-brand-400"
                          >
                            {record.holderName}
                          </Link>
                        </Td>
                        <Td className="text-ink-600 dark:text-ink-300">
                          {record.documentTypeCode
                            ? documentTypeName(record.documentTypeCode, locale)
                            : record.customTypeName}
                        </Td>
                        <Td className="text-ink-500 dark:text-ink-400">{record.entityName}</Td>
                        <Td className="tabular-nums text-ink-600 dark:text-ink-300">
                          {formatDate(record.expiresOn, locale)}
                          {remaining !== null ? (
                            <span className="ms-2 text-xs text-ink-400">
                              {remaining < 0
                                ? t("records.daysOverdue", { days: Math.abs(remaining) })
                                : t("records.daysRemaining", { days: remaining })}
                            </span>
                          ) : null}
                        </Td>
                        <Td className="text-end">
                          <Badge
                            tone={record.status as "valid" | "due_soon" | "critical" | "expired"}
                            className="gap-1.5"
                          >
                            <StatusDot status={record.status} />
                            {t(`status.${record.status}`)}
                          </Badge>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warning" | "danger";
}) {
  const colour =
    tone === "danger"
      ? "text-danger-deep dark:text-danger-mid"
      : tone === "warning"
        ? "text-amber-deep dark:text-amber-mid"
        : "text-ink-950 dark:text-ink-50";

  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
          {label}
        </p>
        <p className={`mt-2 text-3xl font-semibold tabular-nums ${colour}`}>{value}</p>
        {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
