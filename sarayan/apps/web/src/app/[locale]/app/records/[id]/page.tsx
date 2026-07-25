import { AlertTriangle, Paperclip } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  Alert as AlertBox,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatusDot,
} from "@/components/ui";
import { db } from "@/db";
import { alerts, entities, holders, recordFiles, records, renewalTasks, users } from "@/db/schema";
import { documentType, downstreamImpact, estimatePenalty } from "@/content/taxonomy";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, formatDate, formatDateTime, isLocale, translator, type Locale } from "@/lib/i18n";
import { estimateLeadTime } from "@/lib/leadtime";
import { daysRemaining } from "@/lib/records";
import { formOptions } from "@/lib/queries";
import { can } from "@/lib/rbac";
import { acknowledgeAlertAction, deleteRecordAction } from "../../actions";
import { RecordForm } from "../record-form";
import { UploadPanel } from "./upload-panel";

export default async function RecordDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: raw, id } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();

  const rows = await db
    .select({
      record: records,
      holder: holders,
      entity: entities,
      owner: users,
    })
    .from(records)
    .innerJoin(holders, eq(holders.id, records.holderId))
    .innerJoin(entities, eq(entities.id, records.entityId))
    .leftJoin(users, eq(users.id, records.ownerUserId))
    .where(and(eq(records.id, id), eq(records.organisationId, session.organisation.id)))
    .limit(1);

  if (rows.length === 0) notFound();
  const { record, holder, entity, owner } = rows[0];

  const [ladder, files, tasks, options] = await Promise.all([
    db
      .select()
      .from(alerts)
      .where(eq(alerts.recordId, record.id))
      .orderBy(desc(alerts.offsetDays)),
    db
      .select()
      .from(recordFiles)
      .where(eq(recordFiles.recordId, record.id))
      .orderBy(asc(recordFiles.createdAt)),
    db
      .select()
      .from(renewalTasks)
      .where(eq(renewalTasks.recordId, record.id))
      .orderBy(desc(renewalTasks.createdAt)),
    formOptions(session.organisation.id),
  ]);

  const type = record.documentTypeCode ? documentType(record.documentTypeCode) : undefined;
  const remaining = daysRemaining(record.expiresOn);
  const impact = record.documentTypeCode ? downstreamImpact(record.documentTypeCode) : [];
  const leadTime = record.documentTypeCode ? await estimateLeadTime(record.documentTypeCode) : null;
  const penalty =
    record.documentTypeCode && remaining !== null && remaining < 0
      ? estimatePenalty(record.documentTypeCode, Math.abs(remaining))
      : null;

  // Which of this record's dependencies are themselves expired right now.
  const blockingCodes = type?.requires ?? [];
  const blockers =
    blockingCodes.length > 0
      ? await db
          .select({ id: records.id, code: records.documentTypeCode, expiresOn: records.expiresOn })
          .from(records)
          .where(
            and(
              eq(records.organisationId, session.organisation.id),
              eq(records.entityId, record.entityId),
              inArray(records.documentTypeCode, blockingCodes),
              eq(records.status, "expired"),
            ),
          )
      : [];

  const title = type
    ? locale === "ar"
      ? type.nameAr
      : type.nameEn
    : record.customTypeName ?? t("records.title");

  return (
    <>
      <PageHeader
        title={title}
        description={`${holder.name} · ${entity.name}`}
        action={
          <div className="flex items-center gap-3">
            <Badge tone={record.status as "valid" | "due_soon" | "critical" | "expired"} className="gap-1.5">
              <StatusDot status={record.status} />
              {t(`status.${record.status}`)}
            </Badge>
            {can(session.role, "records.delete") ? (
              <form action={deleteRecordAction}>
                <input type="hidden" name="recordId" value={record.id} />
                <input type="hidden" name="locale" value={locale} />
                <Button variant="ghost" size="sm" type="submit">
                  {t("common.delete")}
                </Button>
              </form>
            ) : null}
          </div>
        }
      />

      {blockers.length > 0 ? (
        <AlertBox tone="danger" title={locale === "ar" ? "التجديد معطّل" : "Renewal is blocked"} className="mb-4">
          {locale === "ar"
            ? "لا يمكن تجديد هذه الوثيقة حتى تُجدَّد الوثائق التالية المنتهية:"
            : "This cannot be renewed until these expired dependencies are dealt with:"}{" "}
          {blockers
            .map((blocker) => {
              const blockerType = blocker.code ? documentType(blocker.code) : undefined;
              return blockerType ? (locale === "ar" ? blockerType.nameAr : blockerType.nameEn) : blocker.code;
            })
            .join(", ")}
        </AlertBox>
      ) : null}

      {penalty ? (
        <AlertBox tone="danger" className="mb-4">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {locale === "ar"
              ? `غرامة تقديرية حتى اليوم: ${penalty.currency} ${penalty.amount.toLocaleString()}`
              : `Estimated penalty accrued: ${penalty.currency} ${penalty.amount.toLocaleString()}`}
          </span>
        </AlertBox>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <RecordForm
            locale={locale}
            options={options}
            mode="edit"
            values={{
              id: record.id,
              entityId: record.entityId,
              holderId: record.holderId,
              documentTypeCode: record.documentTypeCode,
              customTypeName: record.customTypeName,
              documentNumber: record.documentNumber,
              issuedOn: record.issuedOn,
              expiresOn: record.expiresOn,
              noExpiry: record.noExpiry,
              issuingAuthority: record.issuingAuthority,
              ownerUserId: record.ownerUserId,
              notes: record.notes,
            }}
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="size-4" aria-hidden />
                {t("records.files")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {session.organisation.metadataOnlyMode ? (
                <AlertBox tone="info">
                  {locale === "ar"
                    ? "وضع البيانات الوصفية فقط مفعّل — لا تُخزَّن الملفات."
                    : "Metadata-only mode is on for this organisation — files are not stored."}
                </AlertBox>
              ) : (
                <>
                  {files.length > 0 ? (
                    <ul className="mb-4 divide-y divide-ink-100 dark:divide-ink-800">
                      {files.map((file) => (
                        <li key={file.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <a
                              href={`/api/files/${file.id}`}
                              className="block truncate text-sm text-brand-700 hover:underline dark:text-brand-400"
                            >
                              {file.filename}
                            </a>
                            <p className="mt-0.5 font-mono text-[10px] text-ink-400" dir="ltr">
                              {file.sha256.slice(0, 24)}…
                            </p>
                          </div>
                          <span className="shrink-0 text-xs tabular-nums text-ink-400">
                            {Math.round(file.sizeBytes / 1024)} KB
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <UploadPanel locale={locale} recordId={record.id} />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t("alerts.ladder")}</CardTitle>
            </CardHeader>
            <CardContent>
              {ladder.length === 0 ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  {record.noExpiry
                    ? locale === "ar"
                      ? "لا انتهاء، لا تنبيهات."
                      : "No expiry, no alerts."
                    : locale === "ar"
                      ? "لا تنبيهات مجدولة."
                      : "No alerts scheduled."}
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {ladder.map((alert) => (
                    <li key={alert.id} className="flex items-center gap-3">
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold tabular-nums ${
                          alert.status === "acknowledged"
                            ? "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200"
                            : alert.status === "sent"
                              ? "bg-amber-soft text-amber-deep"
                              : alert.status === "cancelled"
                                ? "bg-ink-100 text-ink-400 dark:bg-ink-800"
                                : "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300"
                        }`}
                      >
                        {alert.offsetDays > 0 ? alert.offsetDays : `+${Math.abs(alert.offsetDays)}`}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-700 dark:text-ink-300">
                          {t("alerts.due", { date: formatDate(alert.dueOn, locale) })}
                        </p>
                        <p className="text-xs text-ink-400">
                          {(alert.channels as string[]).join(" · ")}
                        </p>
                      </div>
                      {alert.status === "sent" && !alert.acknowledgedAt ? (
                        <form action={acknowledgeAlertAction}>
                          <input type="hidden" name="alertId" value={alert.id} />
                          <Button size="sm" variant="secondary" type="submit">
                            {t("alerts.acknowledge")}
                          </Button>
                        </form>
                      ) : alert.acknowledgedAt ? (
                        <Badge tone="valid">{t("alerts.acknowledged")}</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {type ? (
            <Card>
              <CardHeader>
                <CardTitle>{locale === "ar" ? "التجديد" : "Renewal"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row
                  label={t("renewals.leadTime")}
                  value={
                    leadTime?.source === "learned"
                      ? t("renewals.learnedLeadTime", {
                          days: leadTime.days,
                          count: leadTime.observations,
                        })
                      : t("renewals.estimatedLeadTime", { days: leadTime?.days ?? type.renewalLeadDays })
                  }
                />
                {type.typicalRenewalCost ? (
                  <Row
                    label={t("renewals.cost")}
                    value={`${type.typicalRenewalCost.currency} ${type.typicalRenewalCost.amount.toLocaleString()}`}
                  />
                ) : null}
                <Row label={t("records.authority")} value={type.issuingAuthority} />

                {tasks.length > 0 ? (
                  <div className="border-t border-ink-100 pt-3 dark:border-ink-800">
                    <p className="text-xs uppercase tracking-wide text-ink-500">
                      {t("renewals.title")}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {tasks.map((task) => (
                        <li key={task.id} className="flex justify-between gap-2 text-xs">
                          <span className="text-ink-600 dark:text-ink-300">
                            {task.status} · {task.startedOn ?? "—"}
                          </span>
                          {task.completedOn ? (
                            <span className="tabular-nums text-ink-400">→ {task.newExpiryDate}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <Link href={`/${locale}/app/renewals?record=${record.id}`}>
                  <Button size="sm" variant="secondary" className="w-full">
                    {t("renewals.start")}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : null}

          {impact.length > 0 ? (
            <Card className="border-danger-mid/30">
              <CardHeader>
                <CardTitle className="text-danger-deep dark:text-danger-mid">
                  {locale === "ar" ? "ينهار إذا انتهت" : "Breaks when this lapses"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-ink-700 dark:text-ink-300">
                  {impact.map((entry) => (
                    <li key={entry.code}>· {locale === "ar" ? entry.nameAr : entry.nameEn}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-2 p-5 text-xs text-ink-500 dark:text-ink-400">
              <p>
                {locale === "ar" ? "أُنشئ" : "Created"} {formatDateTime(record.createdAt, locale)}
              </p>
              <p>
                {locale === "ar" ? "آخر تعديل" : "Updated"} {formatDateTime(record.updatedAt, locale)}
              </p>
              {owner ? (
                <p>
                  {t("records.owner")}: {owner.name}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
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
