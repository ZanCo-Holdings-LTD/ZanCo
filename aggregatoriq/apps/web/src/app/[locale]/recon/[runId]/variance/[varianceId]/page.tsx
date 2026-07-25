import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireCauseCode } from '@aggregatoriq/core';
import { Link } from '@/i18n/routing';
import { guard } from '@/components/guard';
import { Badge, Card, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { varianceDetail } from '@/lib/queries';
import { amount, percent, plainDate } from '@/lib/format';

/**
 * The drill-through.
 *
 * The brief calls this the trust-building feature and says not to compromise it,
 * so it is a page of its own rather than a tooltip: the arithmetic in full, and
 * beneath it the actual rows of the actual file, rendered as they were stored.
 * Anyone can check the number themselves, which is the entire point.
 */
export default async function VarianceDetailPage({
  params,
}: {
  params: Promise<{ locale: string; runId: string; varianceId: string }>;
}) {
  const { locale, runId, varianceId } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('recon');
  const common = await getTranslations('common');

  const resolved = await guard();
  if (!resolved.ok) return resolved.node;

  const detail = await varianceDetail(resolved.membership, varianceId);
  if (detail === null) notFound();

  const { variance, sourceRows } = detail;
  const cause = requireCauseCode(variance.causeCode);

  return (
    <div className="space-y-6">
      <PageHeader
        title={locale === 'ar' ? (cause.labelAr ?? cause.label) : cause.label}
        subtitle={cause.description}
        action={
          <Link
            href={`/recon/${runId}`}
            className="text-sm text-brand hover:underline"
          >
            {common('back')}
          </Link>
        }
      />

      {!cause.countsTowardsRecovery && (
        <Badge tone="neutral">{t('notClaimable')}</Badge>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('expected')} value={amount(variance.expectedMinor, variance.currency, locale)} />
        <Stat label={t('actual')} value={amount(variance.actualMinor, variance.currency, locale)} />
        <Stat
          label={t('delta')}
          value={amount(variance.deltaMinor, variance.currency, locale)}
          tone={variance.deltaMinor > 0 ? 'warning' : 'neutral'}
        />
        <Stat label={t('confidence')} value={percent(variance.confidence, locale)} />
      </div>

      <Card title={t('computation')}>
        <p className="text-sm leading-relaxed text-ink">{variance.evidence.computation}</p>

        <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          {Object.entries(variance.evidence.inputs).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 border-b border-line py-1.5">
              <dt className="text-ink-muted">{key}</dt>
              <dd className="font-medium text-ink" data-numeric>
                {value === null ? common('notAvailable') : String(value)}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs text-ink-muted">
          <code data-numeric>{variance.evidence.rule}</code>
        </p>
      </Card>

      <Card title={t('sourceRows')} hint={t('sourceRowsHint')}>
        {sourceRows.length === 0 ? (
          // Unreachable in practice: the database constraint refuses a variance
          // with no source rows. Handled anyway, because "the evidence is
          // missing" must never render as a blank panel.
          <p className="text-sm text-critical">
            {variance.evidence.source_row_ids.join(', ')}
          </p>
        ) : (
          <div className="space-y-5">
            {sourceRows.map((row) => (
              <div key={row.id}>
                <p className="mb-2 text-xs text-ink-muted">
                  {row.originalFilename ?? common('notAvailable')} · row {row.rowIndex + 1}
                  {row.periodStart !== null && (
                    <>
                      {' · '}
                      {plainDate(row.periodStart, locale)} – {plainDate(row.periodEnd, locale)}
                    </>
                  )}
                </p>
                <Table>
                  <thead>
                    <tr>
                      <Th>{common('status')}</Th>
                      <Th>{common('amount')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries((row.raw ?? {}) as Record<string, unknown>)
                      .filter(([key]) => !key.startsWith('_'))
                      .map(([key, value]) => (
                        <tr key={key}>
                          <Td>
                            <span className="text-xs text-ink-muted">{key}</span>
                          </Td>
                          <Td>
                            <span className="font-mono text-xs" data-numeric>
                              {String(value)}
                            </span>
                          </Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
