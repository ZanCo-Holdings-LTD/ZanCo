import { Download, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { db } from "@/db";
import { entities, evidencePacks, users } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { DEFAULT_LOCALE, formatDateTime, isLocale, translator, type Locale } from "@/lib/i18n";
import { can } from "@/lib/rbac";

/**
 * Evidence packs.
 *
 * Job to be done #2, made into one button. The generated PDF carries a SHA-256
 * over the register's canonical form; anyone can check that hash on the public
 * verify page without an account.
 */
export default async function EvidencePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);
  const session = await requireSession();

  const entityOptions = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(and(eq(entities.organisationId, session.organisation.id), isNull(entities.archivedAt)))
    .orderBy(asc(entities.name));

  const history = await db
    .select({
      pack: evidencePacks,
      byName: users.name,
    })
    .from(evidencePacks)
    .leftJoin(users, eq(users.id, evidencePacks.generatedBy))
    .where(eq(evidencePacks.organisationId, session.organisation.id))
    .orderBy(desc(evidencePacks.generatedAt))
    .limit(30);

  const allowed = can(session.role, "evidence.generate");

  return (
    <>
      <PageHeader
        title={t("evidence.title")}
        description={
          locale === "ar"
            ? "وثيقة واحدة موثّقة بالوقت وقابلة للتحقق، لبنك أو مدقق أو عميل."
            : "One timestamped, verifiable document for a bank, an auditor or a client."
        }
      />

      {allowed ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("evidence.generate")}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* A GET form: generating a pack is idempotent for identical data,
                so it is safe and shareable as a link. */}
            <form action="/api/evidence" method="get" className="flex flex-wrap items-end gap-3">
              <Field label={t("records.entity")} htmlFor="entity" className="min-w-52">
                <Select id="entity" name="entity" defaultValue="all">
                  <option value="all">{locale === "ar" ? "كل المنشآت" : "All entities"}</option>
                  {entityOptions.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("records.status")} htmlFor="status" className="min-w-44">
                <Select id="status" name="status" defaultValue="all">
                  <option value="all">{t("records.filterAll")}</option>
                  {(["valid", "due_soon", "critical", "expired"] as const).map((status) => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" className="gap-2">
                <Download className="size-4" aria-hidden />
                {t("evidence.download")}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {history.length === 0 ? (
        <EmptyState
          title={
            locale === "ar"
              ? "لم تُنشأ أي حزمة بعد."
              : "No packs generated yet."
          }
          body={
            locale === "ar"
              ? "الحزمة تثبت ما كان في السجل لحظة إنشائها."
              : "A pack certifies what the register contained at the moment it was generated."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>{t("evidence.scope")}</Th>
                  <Th className="text-end">{t("records.title")}</Th>
                  <Th>{locale === "ar" ? "أُنشئت" : "Generated"}</Th>
                  <Th>{locale === "ar" ? "البصمة" : "Hash"}</Th>
                  <Th className="text-end" />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.pack.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                    <Td className="text-ink-700 dark:text-ink-300">{row.pack.scope}</Td>
                    <Td className="text-end tabular-nums text-ink-600 dark:text-ink-300">
                      {row.pack.recordCount}
                    </Td>
                    <Td className="text-ink-500 dark:text-ink-400">
                      {formatDateTime(row.pack.generatedAt, locale)}
                      {row.byName ? <span className="block text-xs">{row.byName}</span> : null}
                    </Td>
                    <Td>
                      <span className="font-mono text-[11px] text-ink-400" dir="ltr">
                        {row.pack.hash.slice(0, 16)}…
                      </span>
                    </Td>
                    <Td className="text-end">
                      <Link
                        href={`/${locale}/verify/${row.pack.hash}`}
                        className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline dark:text-brand-400"
                      >
                        <ShieldCheck className="size-3.5" aria-hidden />
                        {t("evidence.verify")}
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-ink-500 dark:text-ink-400">
        {locale === "ar"
          ? "البصمة تغطي بيانات السجل، لا شكل الوثيقة — لذا تبقى الحزمة قابلة للتحقق حتى بعد تغيّر التصميم. إعادة إنشاء نفس البيانات في نفس الثانية تنتج البصمة نفسها."
          : "The hash covers the register's data, not the PDF's layout — so a pack stays verifiable across design changes. Regenerating identical data in the same second reproduces the same hash."}
      </p>
    </>
  );
}
