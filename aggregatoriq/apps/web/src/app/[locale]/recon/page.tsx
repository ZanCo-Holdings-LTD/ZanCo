import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { guard } from '@/components/guard';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { reconRunsData } from '@/lib/queries';
import { amount, count, plainDate } from '@/lib/format';

export default async function ReconIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('recon');
  const common = await getTranslations('common');

  const resolved = await guard();
  if (!resolved.ok) return resolved.node;

  const { runs, branches, aggregators } = await reconRunsData(resolved.membership);

  const branchName = (id: string): string =>
    branches.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');
  const aggregatorName = (id: string): string =>
    aggregators.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} />

      <Card>
        {runs.length === 0 ? (
          <EmptyState title={common('empty')} hint={t('newRun')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{common('branch')}</Th>
                <Th>{common('aggregator')}</Th>
                <Th>{common('period')}</Th>
                <Th numeric>{t('findings')}</Th>
                <Th numeric>{t('unmatched')}</Th>
                <Th numeric>{t('recoveryTotal')}</Th>
                <Th>{t('engineVersion')}</Th>
                <Th>{common('viewDetail')}</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <Td>{branchName(run.branchId)}</Td>
                  <Td>{aggregatorName(run.aggregatorId)}</Td>
                  <Td>
                    {plainDate(run.periodStart, locale)} – {plainDate(run.periodEnd, locale)}
                  </Td>
                  <Td numeric>{count(run.varianceCount, locale)}</Td>
                  <Td numeric>
                    {run.unmatchedLineCount > 0 ? (
                      <Badge tone="warning">{count(run.unmatchedLineCount, locale)}</Badge>
                    ) : (
                      count(0, locale)
                    )}
                  </Td>
                  <Td numeric>{amount(run.recoveryTotalMinor, run.currency, locale)}</Td>
                  <Td>
                    {/* Recorded per run so a figure from three months ago stays
                        explainable when the rules change. */}
                    <code className="text-xs text-ink-muted" data-numeric>
                      {run.engineVersion}
                    </code>
                  </Td>
                  <Td>
                    <Link
                      href={`/recon/${run.id}`}
                      className="text-brand hover:underline"
                    >
                      {common('viewDetail')}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
