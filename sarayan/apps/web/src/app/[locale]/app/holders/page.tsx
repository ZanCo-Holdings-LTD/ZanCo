import { and, asc, count, eq, isNull } from "drizzle-orm";
import { Badge, Card, CardContent, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { entities, holders, records } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { formOptions } from "@/lib/queries";
import { can } from "@/lib/rbac";
import { archiveHolderAction } from "../actions";
import { HolderForm } from "./holder-form";

export default async function HoldersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();

  const rows = await db
    .select({
      holder: holders,
      entityName: entities.name,
      recordCount: count(records.id),
    })
    .from(holders)
    .innerJoin(entities, eq(entities.id, holders.entityId))
    .leftJoin(records, and(eq(records.holderId, holders.id), isNull(records.archivedAt)))
    .where(and(eq(holders.organisationId, session.organisation.id), isNull(holders.archivedAt)))
    .groupBy(holders.id, entities.name)
    .orderBy(asc(holders.name))
    .limit(500);

  const options = await formOptions(session.organisation.id);
  const editable = can(session.role, "holders.manage");

  const kindLabels: Record<string, { en: string; ar: string }> = {
    person: { en: "Person", ar: "شخص" },
    vehicle: { en: "Vehicle", ar: "مركبة" },
    asset: { en: "Asset", ar: "أصل" },
    entity: { en: "Entity", ar: "منشأة" },
  };

  return (
    <>
      <PageHeader
        title={locale === "ar" ? "الحاملون" : "Holders"}
        description={
          locale === "ar"
            ? "الأشخاص والمركبات والأصول والمنشآت التي تخصّها السجلات."
            : "The people, vehicles, assets and entities that records belong to."
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          {rows.length === 0 ? (
            <EmptyState
              title={
                locale === "ar"
                  ? "لا يوجد حاملون بعد."
                  : "No holders yet."
              }
              body={
                locale === "ar"
                  ? "أضف أول واحد من النموذج المجاور."
                  : "Add the first one with the form beside this."
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <thead>
                    <tr>
                      <Th>{locale === "ar" ? "الاسم" : "Name"}</Th>
                      <Th>{locale === "ar" ? "النوع" : "Type"}</Th>
                      <Th>{t("entities.title")}</Th>
                      <Th className="text-end">{t("records.title")}</Th>
                      {editable ? <Th className="text-end" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.holder.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                        <Td>
                          <p className="font-medium text-ink-900 dark:text-ink-100">
                            {row.holder.name}
                          </p>
                          {row.holder.identifier || row.holder.department ? (
                            <p className="text-xs text-ink-400">
                              {[row.holder.identifier, row.holder.department]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <Badge tone="neutral">
                            {locale === "ar"
                              ? kindLabels[row.holder.kind]?.ar
                              : kindLabels[row.holder.kind]?.en}
                          </Badge>
                        </Td>
                        <Td className="text-ink-500 dark:text-ink-400">{row.entityName}</Td>
                        <Td className="text-end tabular-nums text-ink-600 dark:text-ink-300">
                          {row.recordCount}
                        </Td>
                        {editable ? (
                          <Td className="text-end">
                            <form action={archiveHolderAction}>
                              <input type="hidden" name="holderId" value={row.holder.id} />
                              <button
                                type="submit"
                                className="text-xs text-ink-400 hover:text-danger-deep"
                              >
                                {locale === "ar" ? "أرشفة" : "Archive"}
                              </button>
                            </form>
                          </Td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        {editable ? (
          <div>
            <HolderForm locale={locale} entities={options.entities} />
          </div>
        ) : null}
      </div>
    </>
  );
}
