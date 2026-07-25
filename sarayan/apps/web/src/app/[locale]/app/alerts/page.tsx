import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import Link from "next/link";
import { today } from "@sarayan/core-watch";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { db } from "@/db";
import { alerts, entities, holders, records, users } from "@/db/schema";
import { documentTypeName } from "@/content/taxonomy";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, formatDate, formatDateTime, isLocale, translator, type Locale } from "@/lib/i18n";
import { acknowledgeAlertAction, acknowledgeAllAction } from "../actions";

/**
 * The alert inbox.
 *
 * Acknowledgement is the whole interaction. Monthly acknowledgements per
 * account is the retention leading indicator, so the button is the first thing
 * on the row and takes one click with no confirmation dialogue in the way.
 */
export default async function AlertsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();

  const waiting = await db
    .select({
      alert: alerts,
      recordId: records.id,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      expiresOn: records.expiresOn,
      status: records.status,
      holderName: holders.name,
      entityName: entities.name,
    })
    .from(alerts)
    .innerJoin(records, eq(records.id, alerts.recordId))
    .innerJoin(holders, eq(holders.id, records.holderId))
    .innerJoin(entities, eq(entities.id, records.entityId))
    .where(
      and(
        eq(alerts.organisationId, session.organisation.id),
        eq(alerts.status, "sent"),
        isNull(alerts.acknowledgedAt),
      ),
    )
    .orderBy(asc(records.expiresOn))
    .limit(200);

  const upcoming = await db
    .select({
      alert: alerts,
      recordId: records.id,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      holderName: holders.name,
    })
    .from(alerts)
    .innerJoin(records, eq(records.id, alerts.recordId))
    .innerJoin(holders, eq(holders.id, records.holderId))
    .where(and(eq(alerts.organisationId, session.organisation.id), eq(alerts.status, "scheduled")))
    .orderBy(asc(alerts.dueOn))
    .limit(15);

  const recentlyAcknowledged = await db
    .select({
      alert: alerts,
      holderName: holders.name,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      byName: users.name,
    })
    .from(alerts)
    .innerJoin(records, eq(records.id, alerts.recordId))
    .innerJoin(holders, eq(holders.id, records.holderId))
    .leftJoin(users, eq(users.id, alerts.acknowledgedBy))
    .where(
      and(eq(alerts.organisationId, session.organisation.id), eq(alerts.status, "acknowledged")),
    )
    .orderBy(desc(alerts.acknowledgedAt))
    .limit(10);

  const asOf = today();
  void lte;

  const label = (code: string | null, custom: string | null) =>
    code ? documentTypeName(code, locale) : custom ?? "—";

  return (
    <>
      <PageHeader
        title={t("alerts.title")}
        description={
          waiting.length > 0
            ? `${waiting.length} ${t("alerts.unacknowledged").toLowerCase()}`
            : undefined
        }
        action={
          waiting.length > 0 ? (
            <form action={acknowledgeAllAction}>
              <Button variant="secondary" type="submit">
                {locale === "ar" ? "استلام الكل" : "Acknowledge all"}
              </Button>
            </form>
          ) : undefined
        }
      />

      {waiting.length === 0 ? (
        <EmptyState title={t("alerts.empty")} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>{t("records.holder")}</Th>
                  <Th>{t("records.documentType")}</Th>
                  <Th>{t("records.expires")}</Th>
                  <Th>{t("alerts.channels")}</Th>
                  <Th className="text-end" />
                </tr>
              </thead>
              <tbody>
                {waiting.map((row) => (
                  <tr key={row.alert.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                    <Td>
                      <Link
                        href={`/${locale}/app/records/${row.recordId}`}
                        className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100 dark:hover:text-brand-400"
                      >
                        {row.holderName}
                      </Link>
                      <p className="text-xs text-ink-400">{row.entityName}</p>
                    </Td>
                    <Td className="text-ink-600 dark:text-ink-300">
                      {label(row.documentTypeCode, row.customTypeName)}
                    </Td>
                    <Td className="tabular-nums">
                      <span
                        className={
                          row.status === "expired"
                            ? "font-medium text-danger-deep dark:text-danger-mid"
                            : "text-ink-600 dark:text-ink-300"
                        }
                      >
                        {formatDate(row.expiresOn, locale)}
                      </span>
                      <p className="text-xs text-ink-400">
                        {row.alert.offsetDays > 0
                          ? locale === "ar"
                            ? `تنبيه ${row.alert.offsetDays} يوماً`
                            : `${row.alert.offsetDays}-day alert`
                          : locale === "ar"
                            ? "بعد الانتهاء"
                            : "post-expiry"}
                        {row.alert.escalationCount > 0
                          ? locale === "ar"
                            ? ` · صُعّد ${row.alert.escalationCount}×`
                            : ` · escalated ${row.alert.escalationCount}×`
                          : ""}
                      </p>
                    </Td>
                    <Td className="text-xs text-ink-500">
                      {(row.alert.channels as string[]).join(" · ")}
                    </Td>
                    <Td className="text-end">
                      <form action={acknowledgeAlertAction}>
                        <input type="hidden" name="alertId" value={row.alert.id} />
                        <Button size="sm" type="submit">
                          {t("alerts.acknowledge")}
                        </Button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {locale === "ar" ? "التالي في الجدول" : "Next scheduled"}
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-ink-400">{t("common.none")}</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((row) => (
                  <li key={row.alert.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-ink-700 dark:text-ink-300">
                      {row.holderName} · {label(row.documentTypeCode, row.customTypeName)}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-400">
                      {formatDate(row.alert.dueOn, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {t("alerts.acknowledged")}
            </h2>
            {recentlyAcknowledged.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-ink-400">{t("common.none")}</p>
            ) : (
              <ul className="space-y-2">
                {recentlyAcknowledged.map((row) => (
                  <li key={row.alert.id} className="text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-ink-700 dark:text-ink-300">
                        {row.holderName} · {label(row.documentTypeCode, row.customTypeName)}
                      </span>
                      <Badge tone="valid" className="shrink-0">
                        {formatDateTime(row.alert.acknowledgedAt, locale)}
                      </Badge>
                    </div>
                    {row.byName ? (
                      <p className="mt-0.5 text-xs text-ink-400">
                        {t("alerts.acknowledgedBy", { name: row.byName })}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-ink-400">
        {locale === "ar" ? `اعتباراً من ${asOf}` : `As of ${asOf}`}
      </p>
    </>
  );
}
