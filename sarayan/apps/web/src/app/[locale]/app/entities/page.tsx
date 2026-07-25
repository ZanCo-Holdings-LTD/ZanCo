import { daysBetween, today } from "@sarayan/core-watch";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import {
  Badge,
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
import { entities, records } from "@/db/schema";
import { estimatePenalty } from "@/content/taxonomy";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { agencyMonthlyPence, formatPrice, planFor } from "@/lib/plans";
import { can } from "@/lib/rbac";
import { EntityForm } from "./entity-form";

/**
 * Entities, and the agency console.
 *
 * For a direct customer this is a short list of legal entities. For an agency
 * it is the product: "show me expiry exposure across all my clients so I can
 * bill renewal work proactively." Same page, same query — the exposure columns
 * are what make it a console rather than a list.
 */
export default async function EntitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();

  const rows = await db
    .select({
      entity: entities,
      total: sql<number>`count(${records.id})::int`,
      dueSoon: sql<number>`count(*) filter (where ${records.status} = 'due_soon')::int`,
      critical: sql<number>`count(*) filter (where ${records.status} = 'critical')::int`,
      expired: sql<number>`count(*) filter (where ${records.status} = 'expired')::int`,
    })
    .from(entities)
    .leftJoin(records, and(eq(records.entityId, entities.id), isNull(records.archivedAt)))
    .where(and(eq(entities.organisationId, session.organisation.id), isNull(entities.archivedAt)))
    .groupBy(entities.id)
    .orderBy(asc(entities.name));

  // Per-entity penalty exposure, so an agency can quote renewal work with a
  // number rather than a warning.
  const expired = await db
    .select({
      entityId: records.entityId,
      documentTypeCode: records.documentTypeCode,
      expiresOn: records.expiresOn,
    })
    .from(records)
    .where(
      and(
        eq(records.organisationId, session.organisation.id),
        eq(records.status, "expired"),
        isNull(records.archivedAt),
      ),
    );

  const exposureByEntity = new Map<string, { amount: number; currency: string }>();
  const asOf = today();
  for (const record of expired) {
    if (!record.documentTypeCode || !record.expiresOn) continue;
    const late = Math.max(0, daysBetween(record.expiresOn, asOf));
    const penalty = estimatePenalty(record.documentTypeCode, late);
    if (!penalty) continue;
    const current = exposureByEntity.get(record.entityId);
    exposureByEntity.set(record.entityId, {
      amount: (current?.amount ?? 0) + penalty.amount,
      currency: penalty.currency,
    });
  }

  const plan = planFor(session.organisation.tier);
  const isAgency = session.organisation.isAgency || plan.multiEntityConsole;
  const editable = can(session.role, "entities.manage");

  return (
    <>
      <PageHeader
        title={isAgency ? t("entities.console") : t("entities.title")}
        description={
          isAgency
            ? locale === "ar"
              ? `${rows.length} منشأة · ${formatPrice(agencyMonthlyPence(rows.length), locale)} شهرياً`
              : `${rows.length} entities · ${formatPrice(agencyMonthlyPence(rows.length), locale)} per month`
            : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          {rows.length === 0 ? (
            <EmptyState title={locale === "ar" ? "لا منشآت بعد." : "No entities yet."} />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <thead>
                    <tr>
                      <Th>{locale === "ar" ? "المنشأة" : "Entity"}</Th>
                      <Th className="text-end">{t("records.title")}</Th>
                      <Th className="text-end">{t("status.due_soon")}</Th>
                      <Th className="text-end">{t("status.expired")}</Th>
                      <Th className="text-end">{t("entities.exposure")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const exposure = exposureByEntity.get(row.entity.id);
                      return (
                        <tr key={row.entity.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                          <Td>
                            <Link
                              href={`/${locale}/app/records?entity=${row.entity.id}`}
                              className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100 dark:hover:text-brand-400"
                            >
                              {row.entity.name}
                            </Link>
                            <p className="text-xs text-ink-400">
                              {[row.entity.country, row.entity.clientReference]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </Td>
                          <Td className="text-end tabular-nums text-ink-600 dark:text-ink-300">
                            {row.total}
                          </Td>
                          <Td className="text-end tabular-nums">
                            {row.dueSoon + row.critical > 0 ? (
                              <Badge tone="due_soon" className="gap-1.5">
                                <StatusDot status="due_soon" />
                                {row.dueSoon + row.critical}
                              </Badge>
                            ) : (
                              <span className="text-ink-300">—</span>
                            )}
                          </Td>
                          <Td className="text-end tabular-nums">
                            {row.expired > 0 ? (
                              <Badge tone="expired" className="gap-1.5">
                                <StatusDot status="expired" />
                                {row.expired}
                              </Badge>
                            ) : (
                              <span className="text-ink-300">—</span>
                            )}
                          </Td>
                          <Td className="text-end tabular-nums text-danger-deep dark:text-danger-mid">
                            {exposure
                              ? `${exposure.currency} ${exposure.amount.toLocaleString()}`
                              : "—"}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </CardContent>
            </Card>
          )}

          {isAgency ? (
            <p className="mt-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
              {locale === "ar"
                ? "عمود التعرّض يقدّر الغرامات المتراكمة على الوثائق المنتهية لكل عميل — استخدمه لعرض أعمال التجديد قبل أن يطلبها العميل."
                : "The exposure column estimates penalties accruing on each client's expired documents — use it to quote renewal work before the client asks."}
            </p>
          ) : null}
        </div>

        {editable ? (
          <div>
            <EntityForm
              locale={locale}
              defaultCountry={session.organisation.country}
              isAgency={isAgency}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
