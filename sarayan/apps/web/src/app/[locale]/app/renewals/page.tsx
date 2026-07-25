import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import Link from "next/link";
import { addDays, today } from "@sarayan/core-watch";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { db } from "@/db";
import { entities, holders, records, renewalTasks, users } from "@/db/schema";
import { documentType, documentTypeName } from "@/content/taxonomy";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, formatDate, isLocale, translator, type Locale } from "@/lib/i18n";
import { estimateLeadTimes } from "@/lib/leadtime";
import { formOptions } from "@/lib/queries";
import { can } from "@/lib/rbac";
import { CompleteRenewalForm, StartRenewalForm } from "./renewal-forms";

/**
 * Renewals.
 *
 * Two lists: what should be started now (driven by each document type's lead
 * time, learned where there is enough data and hand-curated otherwise), and
 * what is already in flight. Completing a renewal writes the new expiry back to
 * the record, restarts the alert ladder, and contributes an observation to the
 * lead-time statistics.
 */
export default async function RenewalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ record?: string }>;
}) {
  const { locale: raw } = await params;
  const { record: preselected } = await searchParams;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();
  const organisationId = session.organisation.id;

  const active = await db
    .select({
      task: renewalTasks,
      recordId: records.id,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      expiresOn: records.expiresOn,
      holderName: holders.name,
      entityName: entities.name,
      assigneeName: users.name,
    })
    .from(renewalTasks)
    .innerJoin(records, eq(records.id, renewalTasks.recordId))
    .innerJoin(holders, eq(holders.id, records.holderId))
    .innerJoin(entities, eq(entities.id, records.entityId))
    .leftJoin(users, eq(users.id, renewalTasks.assigneeUserId))
    .where(
      and(
        eq(renewalTasks.organisationId, organisationId),
        ne(renewalTasks.status, "completed"),
        ne(renewalTasks.status, "cancelled"),
      ),
    )
    .orderBy(asc(renewalTasks.targetOn))
    .limit(100);

  const activeRecordIds = new Set(active.map((row) => row.recordId));

  // Records whose lead time says the renewal should already have started.
  const candidates = await db
    .select({
      id: records.id,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      expiresOn: records.expiresOn,
      status: records.status,
      holderName: holders.name,
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
        or(eq(records.status, "due_soon"), eq(records.status, "critical"), eq(records.status, "expired")),
      ),
    )
    .orderBy(asc(records.expiresOn))
    .limit(200);

  const leadTimes = await estimateLeadTimes(
    candidates.map((candidate) => candidate.documentTypeCode).filter((code): code is string => Boolean(code)),
  );

  const asOf = today();
  const dueToStart = candidates
    .filter((candidate) => !activeRecordIds.has(candidate.id))
    .map((candidate) => {
      const estimate = candidate.documentTypeCode ? leadTimes.get(candidate.documentTypeCode) : undefined;
      const leadDays =
        estimate?.days ??
        (candidate.documentTypeCode ? documentType(candidate.documentTypeCode)?.renewalLeadDays ?? 30 : 30);
      const startBy = candidate.expiresOn ? addDays(candidate.expiresOn, -leadDays) : null;
      return { ...candidate, leadDays, startBy, estimate };
    })
    .filter((candidate) => candidate.startBy !== null && candidate.startBy <= asOf);

  const options = await formOptions(organisationId);
  const editable = can(session.role, "renewals.manage");

  const completed = await db
    .select({
      task: renewalTasks,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      holderName: holders.name,
    })
    .from(renewalTasks)
    .innerJoin(records, eq(records.id, renewalTasks.recordId))
    .innerJoin(holders, eq(holders.id, records.holderId))
    .where(
      and(eq(renewalTasks.organisationId, organisationId), eq(renewalTasks.status, "completed")),
    )
    .orderBy(desc(renewalTasks.completedOn))
    .limit(10);

  void inArray;
  void lte;

  const label = (code: string | null, custom: string | null) =>
    code ? documentTypeName(code, locale) : custom ?? "—";

  return (
    <>
      <PageHeader title={t("renewals.title")} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
          {locale === "ar" ? "ينبغي أن تبدأ الآن" : "Should be started now"}
        </h2>
        {dueToStart.length === 0 ? (
          <EmptyState
            title={
              locale === "ar"
                ? "لا شيء متأخر عن موعد بدء التجديد."
                : "Nothing is past its renewal start date."
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
                    <Th>{t("records.expires")}</Th>
                    <Th>{t("renewals.leadTime")}</Th>
                    <Th className="text-end" />
                  </tr>
                </thead>
                <tbody>
                  {dueToStart.map((candidate) => (
                    <tr key={candidate.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                      <Td>
                        <Link
                          href={`/${locale}/app/records/${candidate.id}`}
                          className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100 dark:hover:text-brand-400"
                        >
                          {candidate.holderName}
                        </Link>
                        <p className="text-xs text-ink-400">{candidate.entityName}</p>
                      </Td>
                      <Td className="text-ink-600 dark:text-ink-300">
                        {label(candidate.documentTypeCode, candidate.customTypeName)}
                      </Td>
                      <Td className="tabular-nums text-ink-600 dark:text-ink-300">
                        {formatDate(candidate.expiresOn, locale)}
                      </Td>
                      <Td className="text-xs text-ink-500">
                        {candidate.estimate?.source === "learned"
                          ? t("renewals.learnedLeadTime", {
                              days: candidate.leadDays,
                              count: candidate.estimate.observations,
                            })
                          : t("renewals.estimatedLeadTime", { days: candidate.leadDays })}
                      </Td>
                      <Td className="text-end">
                        {editable ? (
                          <StartRenewalForm
                            locale={locale}
                            recordId={candidate.id}
                            defaultTarget={candidate.expiresOn}
                            members={options.members}
                            autoOpen={preselected === candidate.id}
                          />
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
          {locale === "ar" ? "قيد التنفيذ" : "In progress"}
        </h2>
        {active.length === 0 ? (
          <EmptyState title={locale === "ar" ? "لا تجديدات جارية." : "No renewals in progress."} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {active.map((row) => (
              <Card key={row.task.id}>
                <CardHeader>
                  <CardTitle>{row.holderName}</CardTitle>
                  <p className="text-sm text-ink-500 dark:text-ink-400">
                    {label(row.documentTypeCode, row.customTypeName)} · {row.entityName}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge tone={row.task.status === "blocked" ? "expired" : "neutral"}>
                      {row.task.status}
                    </Badge>
                    {row.assigneeName ? (
                      <Badge tone="neutral">
                        {t("renewals.assignee")}: {row.assigneeName}
                      </Badge>
                    ) : null}
                    {row.task.targetOn ? (
                      <Badge tone="due_soon">
                        {t("renewals.target")}: {formatDate(row.task.targetOn, locale)}
                      </Badge>
                    ) : null}
                  </div>
                  {editable ? (
                    <CompleteRenewalForm
                      locale={locale}
                      taskId={row.task.id}
                      currency={session.organisation.country === "SA" ? "SAR" : "AED"}
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {completed.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {locale === "ar" ? "مكتملة مؤخراً" : "Recently completed"}
          </h2>
          <Card>
            <CardContent className="p-5">
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {completed.map((row) => (
                  <li key={row.task.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                    <span className="text-ink-700 dark:text-ink-300">
                      {row.holderName} · {label(row.documentTypeCode, row.customTypeName)}
                    </span>
                    <span className="tabular-nums text-ink-400">
                      {row.task.completedOn} → {row.task.newExpiryDate}
                      {row.task.cost ? ` · ${row.task.currency ?? ""} ${row.task.cost}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </>
  );
}
