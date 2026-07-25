import { getTranslations, setRequestLocale } from 'next-intl/server';
import { publicEnv } from '@/env';
import { guard } from '@/components/guard';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { statementsData } from '@/lib/queries';
import { count, dateTime, plainDate } from '@/lib/format';
import type { ParseStatus, ReceivedVia } from '@aggregatoriq/core';

const STATUS_TONE: Record<ParseStatus, 'positive' | 'warning' | 'critical' | 'neutral'> = {
  parsed: 'positive',
  partially_parsed: 'warning',
  needs_review: 'warning',
  failed: 'critical',
  pending: 'neutral',
};

export default async function StatementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('statements');
  const common = await getTranslations('common');

  const resolved = await guard();
  if (!resolved.ok) return resolved.node;

  const { statements, branches, aggregators, addresses } = await statementsData(
    resolved.membership,
  );
  const emailDomain = publicEnv().NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN;

  const branchName = (id: string | null): string =>
    branches.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');
  const aggregatorName = (id: string | null): string =>
    aggregators.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Card title={t('forwardHere')} hint={t('forwardHint')}>
        {addresses.length === 0 ? (
          <EmptyState title={common('empty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{common('branch')}</Th>
                <Th>{common('aggregator')}</Th>
                <Th>{t('forwardHere')}</Th>
                <Th numeric>{t('rows')}</Th>
              </tr>
            </thead>
            <tbody>
              {addresses.map((address) => (
                <tr key={address.localPart}>
                  <Td>{branchName(address.branchId)}</Td>
                  <Td>{aggregatorName(address.aggregatorId)}</Td>
                  <Td>
                    {/* LTR-isolated: an email address inside an RTL cell would
                        otherwise have its parts reordered on screen. */}
                    <code className="rounded bg-surface-sunken px-2 py-1 text-xs" data-numeric>
                      {address.localPart}@{emailDomain}
                    </code>
                  </Td>
                  <Td numeric>{count(address.receivedCount, locale)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={t('title')}>
        {statements.length === 0 ? (
          <EmptyState title={common('empty')} hint={t('uploadHint')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{common('branch')}</Th>
                <Th>{common('aggregator')}</Th>
                <Th>{common('period')}</Th>
                <Th>{t('receivedVia')}</Th>
                <Th>{t('parseStatus')}</Th>
                <Th numeric>{t('rows')}</Th>
              </tr>
            </thead>
            <tbody>
              {statements.map((statement) => (
                <tr key={statement.id}>
                  <Td>{branchName(statement.branchId)}</Td>
                  <Td>{aggregatorName(statement.aggregatorId)}</Td>
                  <Td>
                    {statement.periodStart === null
                      ? common('notAvailable')
                      : `${plainDate(statement.periodStart, locale)} – ${plainDate(statement.periodEnd, locale)}`}
                    <span className="mt-1 block text-xs text-ink-muted">
                      {statement.originalFilename ?? common('notAvailable')}
                    </span>
                  </Td>
                  <Td>
                    <span className="block text-xs text-ink-muted">
                      {t(`via.${statement.receivedVia as ReceivedVia}`)}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {dateTime(statement.receivedAt, locale)}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[statement.parseStatus]}>
                      {t(`status.${statement.parseStatus}`)}
                    </Badge>
                    {statement.parseError !== null && (
                      // Failures are shown, not hidden behind a spinner.
                      <span className="mt-2 block max-w-sm text-xs leading-relaxed text-ink-muted">
                        {statement.parseError}
                      </span>
                    )}
                  </Td>
                  <Td numeric>{count(statement.rowCount, locale)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
