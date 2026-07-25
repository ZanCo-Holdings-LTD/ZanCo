import { Download, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  PageHeader,
  Select,
  StatusDot,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { db } from "@/db";
import { entities, holders, records } from "@/db/schema";
import { documentTypeName } from "@/content/taxonomy";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, formatDate, isLocale, translator, type Locale } from "@/lib/i18n";
import { daysRemaining } from "@/lib/records";

const PAGE_SIZE = 50;

export default async function RecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; entity?: string; page?: string }>;
}) {
  const { locale: raw } = await params;
  const query = await searchParams;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();

  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const filters: SQL[] = [
    eq(records.organisationId, session.organisation.id),
    isNull(records.archivedAt),
  ];

  if (query.status && query.status !== "all") {
    filters.push(
      eq(records.status, query.status as "valid" | "due_soon" | "critical" | "expired" | "dormant"),
    );
  }
  if (query.entity && query.entity !== "all") {
    filters.push(eq(records.entityId, query.entity));
  }
  if (query.q) {
    const term = `%${query.q.replace(/[%_]/g, "")}%`;
    const search = or(
      ilike(holders.name, term),
      ilike(records.documentNumber, term),
      ilike(records.customTypeName, term),
      ilike(holders.identifier, term),
    );
    if (search) filters.push(search);
  }

  const rows = await db
    .select({
      id: records.id,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      documentNumber: records.documentNumber,
      expiresOn: records.expiresOn,
      noExpiry: records.noExpiry,
      status: records.status,
      holderName: holders.name,
      holderKind: holders.kind,
      entityName: entities.name,
    })
    .from(records)
    .innerJoin(holders, eq(holders.id, records.holderId))
    .innerJoin(entities, eq(entities.id, records.entityId))
    .where(and(...filters))
    // Nulls last: documents with no expiry belong at the bottom, not the top.
    .orderBy(sql`${records.expiresOn} asc nulls last`, asc(holders.name))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);

  const hasMore = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  const entityOptions = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(eq(entities.organisationId, session.organisation.id))
    .orderBy(asc(entities.name));

  const exportHref = `/api/export/records?${new URLSearchParams({
    ...(query.status ? { status: query.status } : {}),
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.q ? { q: query.q } : {}),
  })}`;

  return (
    <>
      <PageHeader
        title={t("records.title")}
        action={
          <div className="flex flex-wrap gap-2">
            <a href={exportHref}>
              <Button variant="ghost" size="sm" className="gap-2">
                <Download className="size-4" aria-hidden />
                CSV
              </Button>
            </a>
            <Link href={`/${locale}/app/records/import`}>
              <Button variant="secondary" className="gap-2">
                <Upload className="size-4" aria-hidden />
                {t("dashboard.importCsv")}
              </Button>
            </Link>
            <Link href={`/${locale}/app/records/new`}>
              <Button className="gap-2">
                <Plus className="size-4" aria-hidden />
                {t("records.add")}
              </Button>
            </Link>
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap gap-2">
        <Input
          name="q"
          defaultValue={query.q ?? ""}
          placeholder={t("records.search")}
          className="w-full sm:w-72"
        />
        <Select name="status" defaultValue={query.status ?? "all"} className="w-auto">
          <option value="all">{t("records.filterAll")}</option>
          {(["valid", "due_soon", "critical", "expired", "dormant"] as const).map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </Select>
        <Select name="entity" defaultValue={query.entity ?? "all"} className="w-auto">
          <option value="all">{t("records.filterEntity")}</option>
          {entityOptions.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {locale === "ar" ? "تصفية" : "Filter"}
        </Button>
      </form>

      {visible.length === 0 ? (
        <EmptyState
          title={t("records.empty")}
          action={
            <Link href={`/${locale}/app/records/new`}>
              <Button>{t("records.add")}</Button>
            </Link>
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
                  <Th>{t("records.number")}</Th>
                  <Th>{t("records.entity")}</Th>
                  <Th>{t("records.expires")}</Th>
                  <Th className="text-end">{t("records.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((record) => {
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
                      <Td className="font-mono text-xs text-ink-500" dir="ltr">
                        {record.documentNumber ?? "—"}
                      </Td>
                      <Td className="text-ink-500 dark:text-ink-400">{record.entityName}</Td>
                      <Td className="tabular-nums text-ink-600 dark:text-ink-300">
                        {record.noExpiry ? (
                          <span className="text-ink-400">{t("status.dormant")}</span>
                        ) : (
                          <>
                            {formatDate(record.expiresOn, locale)}
                            {remaining !== null ? (
                              <span className="ms-2 text-xs text-ink-400">
                                {remaining < 0
                                  ? t("records.daysOverdue", { days: Math.abs(remaining) })
                                  : t("records.daysRemaining", { days: remaining })}
                              </span>
                            ) : null}
                          </>
                        )}
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

      {(page > 1 || hasMore) && (
        <nav className="mt-4 flex justify-between">
          {page > 1 ? (
            <Link href={`?${buildQuery(query, page - 1)}`}>
              <Button variant="secondary" size="sm">
                {t("common.back")}
              </Button>
            </Link>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Link href={`?${buildQuery(query, page + 1)}`}>
              <Button variant="secondary" size="sm">
                {t("common.next")}
              </Button>
            </Link>
          ) : null}
        </nav>
      )}
    </>
  );
}

function buildQuery(query: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value && key !== "page") params.set(key, value);
  }
  params.set("page", String(page));
  return params.toString();
}
