import { getTranslations, setRequestLocale } from 'next-intl/server';
import { guard } from '@/components/guard';
import { Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { settingsData } from '@/lib/queries';
import { percent } from '@/lib/format';

/**
 * Effective margin by channel.
 *
 * The gap column is the point of this screen. An operator knows their contracted
 * rate; almost none of them know what they actually paid once promotions,
 * delivery attribution and adjustments are counted, and the difference between
 * the two is usually several percentage points.
 */
export default async function MarginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('margin');
  const common = await getTranslations('common');

  const resolved = await guard();
  if (!resolved.ok) return resolved.node;

  const { accounts, branches, aggregators } = await settingsData(resolved.membership);

  const branchName = (id: string): string =>
    branches.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');
  const aggregatorName = (id: string): string =>
    aggregators.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');

  // Only the terms currently in force; a superseded rate row is history, not a
  // channel someone is selling through today.
  const current = accounts.filter((account) => account.effectiveTo === null);

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Card title={t('contractedRate')} hint={t('gapHint')}>
        {current.length === 0 ? (
          <EmptyState title={common('empty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{common('branch')}</Th>
                <Th>{common('aggregator')}</Th>
                <Th numeric>{t('contractedRate')}</Th>
                <Th>{t('promoCost')}</Th>
              </tr>
            </thead>
            <tbody>
              {current.map((account) => (
                <tr key={account.id}>
                  <Td>{branchName(account.branchId)}</Td>
                  <Td>{aggregatorName(account.aggregatorId)}</Td>
                  <Td numeric>{percent(account.contractedCommissionRate, locale)}</Td>
                  <Td>
                    <span className="text-xs text-ink-muted">
                      {account.vatTreatment === 'commission_on_gross'
                        ? t('gross')
                        : t('net')}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={t('effectiveRate')} hint={t('gapHint')}>
        <EmptyState
          title={common('empty')}
          hint={t('subtitle')}
        />
      </Card>
    </div>
  );
}
