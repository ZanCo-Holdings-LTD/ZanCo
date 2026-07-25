import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireCauseCode } from '@aggregatoriq/core';
import { Link } from '@/i18n/routing';
import { guard } from '@/components/guard';
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { reconRunDetail } from '@/lib/queries';
import { amount, count, percent, plainDate } from '@/lib/format';

export default async function ReconRunPage({
  params,
}: {
  params: Promise<{ locale: string; runId: string }>;
}) {
  const { locale, runId } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('recon');
  const common = await getTranslations('common');

  const resolved = await guard();
  if (!resolved.ok) return resolved.node;

  const detail = await reconRunDetail(resolved.membership, runId);
  if (detail === null) notFound();

  const { run, variances, branches, aggregators } = detail;

  const branchName =
    branches.find((candidate) => candidate.id === run.branchId)?.name ?? common('notAvailable');
  const aggregatorName =
    aggregators.find((candidate) => candidate.id === run.aggregatorId)?.name ??
    common('notAvailable');

  const claimable = variances.filter(
    (variance) => requireCauseCode(variance.causeCode).countsTowardsRecovery && variance.deltaMinor > 0,
  );
  const flagged = variances.filter(
    (variance) => !requireCauseCode(variance.causeCode).countsTowardsRecovery,
  );

  const warnings = Array.isArray(run.warnings) ? (run.warnings as string[]) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('runTitle')}
        subtitle={`${branchName} · ${aggregatorName} · ${plainDate(run.periodStart, locale)} – ${plainDate(run.periodEnd, locale)}`}
        action={
          <Link href="/recon" className="text-sm text-brand hover:underline">
            {common('back')}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('recoveryTotal')}
          value={amount(run.recoveryTotalMinor, run.currency, locale)}
          tone={run.recoveryTotalMinor > 0 ? 'warning' : 'positive'}
        />
        <Stat label={t('findings')} value={count(variances.length, locale)} />
        <Stat
          label={t('unmatched')}
          value={count(run.unmatchedLineCount, locale)}
          hint={run.unmatchedLineCount > 0 ? t('unmatchedHint') : undefined}
          tone={run.unmatchedLineCount > 0 ? 'warning' : 'neutral'}
        />
        <Stat label={t('engineVersion')} value={run.engineVersion} />
      </div>

      {warnings.length > 0 && (
        <Card title={t('warnings')}>
          <ul className="space-y-2">
            {warnings.map((warning) => (
              <li key={warning} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
                <span aria-hidden className="text-warning">
                  •
                </span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('byCause')}>
        {variances.length === 0 ? (
          // An empty result is a good outcome, and the copy says so rather than
          // leaving someone wondering whether it ran.
          <EmptyState title={t('noFindings')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('byCause')}</Th>
                <Th numeric>{t('expected')}</Th>
                <Th numeric>{t('actual')}</Th>
                <Th numeric>{t('delta')}</Th>
                <Th numeric>{t('confidence')}</Th>
                <Th>{t('evidence')}</Th>
              </tr>
            </thead>
            <tbody>
              {[...claimable, ...flagged].map((variance) => {
                const cause = requireCauseCode(variance.causeCode);
                return (
                  <tr key={variance.id}>
                    <Td>
                      <span className="font-medium text-ink">
                        {locale === 'ar' ? (cause.labelAr ?? cause.label) : cause.label}
                      </span>
                      {!cause.countsTowardsRecovery && (
                        <span className="mt-1 block">
                          <Badge>{t('notClaimable')}</Badge>
                        </span>
                      )}
                    </Td>
                    <Td numeric>{amount(variance.expectedMinor, variance.currency, locale)}</Td>
                    <Td numeric>{amount(variance.actualMinor, variance.currency, locale)}</Td>
                    <Td numeric className="font-medium">
                      {amount(variance.deltaMinor, variance.currency, locale)}
                    </Td>
                    <Td numeric>{percent(variance.confidence, locale)}</Td>
                    <Td>
                      <Link
                        href={`/recon/${runId}/variance/${variance.id}`}
                        className="text-brand hover:underline"
                      >
                        {t('sourceRows')}
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {flagged.length > 0 && (
        <Card title={t('notClaimable')} hint={t('notClaimableHint')}>
          <p className="text-sm leading-relaxed text-ink-muted">
            {count(flagged.length, locale)}
          </p>
        </Card>
      )}
    </div>
  );
}
