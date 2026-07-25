import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireCauseCode } from '@aggregatoriq/core';
import { Link } from '@/i18n/routing';
import { guard } from '@/components/guard';
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { dashboardData } from '@/lib/queries';
import { amount, count, plainDate } from '@/lib/format';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('dashboard');
  const common = await getTranslations('common');
  const recon = await getTranslations('recon');

  const resolved = await guard();
  if (!resolved.ok) return resolved.node;

  const membership = resolved.membership;
  const { branches, aggregators, runs, recovered, summary } = await dashboardData(membership);
  const currency = membership.baseCurrency;

  const identified = runs.reduce((total, run) => total + run.recoveryTotalMinor, 0);
  const openFindings = summary.reduce((total, row) => total + row.count, 0);

  const aggregatorName = (id: string): string =>
    aggregators.find((candidate) => candidate.id === id)?.name ?? '—';
  const branchName = (id: string): string =>
    branches.find((candidate) => candidate.id === id)?.name ?? '—';

  /**
   * Branches carrying the most unresolved money, worst first. This is the
   * working list — the reason someone opens the product on a Monday.
   */
  const byBranch = new Map<string, number>();
  for (const run of runs) {
    byBranch.set(run.branchId, (byBranch.get(run.branchId) ?? 0) + run.recoveryTotalMinor);
  }
  const needingAttention = [...byBranch.entries()]
    .filter(([, total]) => total > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={membership.orgName} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('recoveryIdentified')}
          value={amount(identified, currency, locale)}
          hint={t('recoveryIdentifiedHint')}
          tone={identified > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label={t('recoveredToDate')}
          value={amount(recovered.recoveredMinor, currency, locale)}
          hint={t('recoveredToDateHint')}
          tone={recovered.recoveredMinor > 0 ? 'positive' : 'neutral'}
        />
        <Stat label={t('openVariances')} value={count(openFindings, locale)} />
        <Stat label={common('branch')} value={count(branches.length, locale)} />
      </div>

      {branches.length === 0 ? (
        <Card>
          <EmptyState title={t('noBranches')} />
        </Card>
      ) : runs.length === 0 ? (
        <Card>
          <EmptyState title={t('noRuns')} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={t('topCauses')}>
            {summary.length === 0 ? (
              <EmptyState title={common('empty')} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('topCauses')}</Th>
                    <Th numeric>{common('amount')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.slice(0, 8).map((row) => {
                    const cause = requireCauseCode(row.causeCode);
                    return (
                      <tr key={row.causeCode}>
                        <Td>
                          <span className="font-medium text-ink">
                            {locale === 'ar' ? (cause.labelAr ?? cause.label) : cause.label}
                          </span>
                          {!cause.countsTowardsRecovery && (
                            <span className="ms-2">
                              <Badge>{row.count}</Badge>
                            </span>
                          )}
                        </Td>
                        <Td numeric>{amount(row.totalDeltaMinor, currency, locale)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title={t('branchesNeedingAttention')}>
            {needingAttention.length === 0 ? (
              <EmptyState title={common('empty')} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{common('branch')}</Th>
                    <Th numeric>{t('recoveryIdentified')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {needingAttention.map(([branchId, total]) => (
                    <tr key={branchId}>
                      <Td>{branchName(branchId)}</Td>
                      <Td numeric>{amount(total, currency, locale)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {runs.length > 0 && (
        <Card title={t('title')}>
          <Table>
            <thead>
              <tr>
                <Th>{common('branch')}</Th>
                <Th>{common('aggregator')}</Th>
                <Th>{common('period')}</Th>
                <Th numeric>{recon('findings')}</Th>
                <Th numeric>{t('recoveryIdentified')}</Th>
                <Th>{common('viewDetail')}</Th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 10).map((run) => (
                <tr key={run.id}>
                  <Td>{branchName(run.branchId)}</Td>
                  <Td>{aggregatorName(run.aggregatorId)}</Td>
                  <Td>
                    {plainDate(run.periodStart, locale)} – {plainDate(run.periodEnd, locale)}
                  </Td>
                  <Td numeric>{count(run.varianceCount, locale)}</Td>
                  <Td numeric>{amount(run.recoveryTotalMinor, run.currency, locale)}</Td>
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
        </Card>
      )}
    </div>
  );
}
