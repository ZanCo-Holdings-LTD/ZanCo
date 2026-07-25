import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { DisputeOutcome } from '@aggregatoriq/core';
import { guard } from '@/components/guard';
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { disputesData } from '@/lib/queries';
import { amount, dateTime, percent } from '@/lib/format';

const OUTCOME_TONE: Record<DisputeOutcome, 'neutral' | 'positive' | 'warning' | 'critical'> = {
  pending: 'warning',
  accepted: 'positive',
  partially_accepted: 'positive',
  rejected: 'critical',
  withdrawn: 'neutral',
};

export default async function DisputesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('disputes');
  const common = await getTranslations('common');

  const resolved = await guard();
  if (!resolved.ok) return resolved.node;

  const { disputes, aggregators, recovered } = await disputesData(resolved.membership);
  const currency = resolved.membership.baseCurrency;

  const aggregatorName = (id: string): string =>
    aggregators.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');

  /**
   * Recovery rate: how much of what was claimed actually came back.
   *
   * The most useful number on this page over time, because it is what tells you
   * which cause codes are worth pressing and which arguments the aggregators
   * simply do not accept.
   */
  const successRate =
    recovered.claimedMinor === 0 ? null : recovered.recoveredMinor / recovered.claimedMinor;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('claimed')} value={amount(recovered.claimedMinor, currency, locale)} />
        <Stat
          label={t('recovered')}
          value={amount(recovered.recoveredMinor, currency, locale)}
          tone={recovered.recoveredMinor > 0 ? 'positive' : 'neutral'}
        />
        <Stat label={t('outcome')} value={percent(successRate, locale)} />
      </div>

      <Card>
        {disputes.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('reference')}</Th>
                <Th>{common('aggregator')}</Th>
                <Th numeric>{t('claimed')}</Th>
                <Th numeric>{t('recovered')}</Th>
                <Th>{t('outcome')}</Th>
                <Th>{t('submitted')}</Th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((dispute) => (
                <tr key={dispute.id}>
                  <Td>
                    <span className="font-medium text-ink" data-numeric>
                      {dispute.reference}
                    </span>
                    <span className="mt-1 block text-xs text-ink-muted">
                      {dispute.varianceIds.length}
                    </span>
                  </Td>
                  <Td>{aggregatorName(dispute.aggregatorId)}</Td>
                  <Td numeric>{amount(dispute.claimedMinor, dispute.currency, locale)}</Td>
                  <Td numeric>{amount(dispute.recoveredMinor, dispute.currency, locale)}</Td>
                  <Td>
                    <Badge tone={OUTCOME_TONE[dispute.outcome]}>
                      {t(`outcomes.${dispute.outcome}`)}
                    </Badge>
                  </Td>
                  <Td>{dateTime(dispute.submittedAt, locale)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
