import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { repositories } from '@fieldnote/db';
import { evaluateExportGate } from '@fieldnote/shared';
import { FieldRow } from '@/components/FieldRow';
import { ExportBar } from '@/components/ExportBar';
import { StatusChip } from '@/components/StatusChip';
import { getSession, query } from '@/lib/session';

/**
 * Review workspace — the primary screen.
 *
 * Section by section, in template order, with every generated value showing
 * where it came from. The export control is pinned at the bottom and stays
 * disabled while any amber field is untouched. That gate is enforced again
 * server-side before rendering; this one exists so the reviewer can see what is
 * blocking them, not to be the control.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ locale: string; reportId: string }>;
}) {
  const { locale, reportId } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect('/sign-in');

  const data = await query(session, async (tx) => {
    const report = await repositories.reports.findById(tx, session.orgId, reportId);
    if (!report) return null;

    return {
      report,
      values: await repositories.values.loadForReview(tx, reportId, report.templateId),
      photos: await repositories.captures.listPhotos(tx, reportId),
      versions: await repositories.delivery.listVersions(tx, reportId),
    };
  });

  if (!data) notFound();

  const gate = evaluateExportGate(
    data.values.map((row) => ({
      value: row.value,
      confidence: row.confidence,
      required: row.required,
      editedByHuman: row.editedByHuman,
      reviewedAt: row.reviewedAt,
    })),
  );

  // Group into sections. `loadForReview` already returns template order, so a
  // Map preserves it without a second sort.
  const sections = new Map<string, { title: string; rows: typeof data.values }>();
  for (const row of data.values) {
    let section = sections.get(row.sectionKey);
    if (!section) {
      section = { title: row.sectionTitle, rows: [] };
      sections.set(row.sectionKey, section);
    }
    section.rows.push(row);
  }

  const t = await getTranslations('review');
  const photosBySection = new Map<string, typeof data.photos>();
  for (const photo of data.photos) {
    const key = photo.sectionKey ?? '';
    photosBySection.set(key, [...(photosBySection.get(key) ?? []), photo]);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 pb-32 pt-10">
      <header className="mb-8 border-b border-neutral-200 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{data.report.propertyAddress}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {[data.report.clientName, data.report.reference].filter(Boolean).join(' · ')}
            </p>
          </div>
          <StatusChip status={data.report.status} />
        </div>
      </header>

      <div className="space-y-10">
        {[...sections.entries()].map(([key, section]) => (
          <section key={key} aria-labelledby={`section-${key}`}>
            <h2
              id={`section-${key}`}
              className="mb-3 border-b border-neutral-200 pb-1.5 text-base font-semibold"
            >
              {section.title}
            </h2>

            <div className="space-y-1">
              {section.rows.map((row) => (
                <FieldRow
                  key={row.fieldId}
                  reportId={reportId}
                  fieldId={row.fieldId}
                  label={row.label}
                  type={row.type}
                  required={row.required}
                  enumValues={row.enumValues}
                  value={row.value}
                  generatedValue={row.generatedValue}
                  confidence={row.confidence}
                  sourceSpan={row.sourceSpan}
                  editedByHuman={row.editedByHuman}
                  reviewedAt={row.reviewedAt?.toISOString() ?? null}
                />
              ))}
            </div>

            {(photosBySection.get(key)?.length ?? 0) > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {t('photos')}
                </h3>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {photosBySection.get(key)!.map((photo) => (
                    <li key={photo.id} className="text-xs text-ink-muted">
                      <div className="aspect-[4/3] rounded bg-neutral-100 ring-1 ring-neutral-200" />
                      <p className="mt-1 line-clamp-2">{photo.caption ?? '—'}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>

      <ExportBar
        reportId={reportId}
        canExport={gate.canExport}
        untouchedAmberCount={gate.untouchedAmberCount}
        latestVersion={data.versions[0]?.versionNo ?? null}
      />
    </main>
  );
}
