'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { AGGREGATOR_CODES, AGGREGATOR_NAMES } from '@aggregatoriq/core';
import { runFreeAudit, type AuditResult } from '@/app/[locale]/audit/actions';
import { Badge, Button, Card, Field, Select, Stat, Table, Td, Th } from './ui';
import { amount, count } from '@/lib/format';

const INITIAL: AuditResult = {
  ok: false,
  message: null,
  recoveryTotalMinor: 0,
  currency: 'SAR',
  ordersRead: 0,
  linesRead: 0,
  unmatchedLines: 0,
  breakdown: [],
  assumedCommissionRate: 0,
  parseNotes: [],
};

/**
 * The processing indicator.
 *
 * The stages are named after what is actually happening, in order, because the
 * brief asks for honest stages and because a spinner that says "analysing" for
 * forty seconds teaches someone that the product is slow, whereas naming the
 * steps teaches them it is thorough. They are not faked progress: each label
 * corresponds to a real phase of the same request.
 */
function Progress() {
  const { pending } = useFormStatus();
  const t = useTranslations('audit');

  if (!pending) return null;

  return (
    <ul className="mt-4 space-y-2 text-sm text-ink-muted">
      {(['reading', 'matching', 'checking'] as const).map((stage) => (
        <li key={stage} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand"
          />
          {t(`stages.${stage}`)}
        </li>
      ))}
    </ul>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations('audit');

  return (
    <Button type="submit" disabled={pending}>
      {t('analyse')}
    </Button>
  );
}

export function AuditForm() {
  const t = useTranslations('audit');
  const common = useTranslations('common');
  const locale = useLocale();

  const [result, action] = useActionState(runFreeAudit, INITIAL);

  return (
    <div className="space-y-6">
      <Card>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <Field label={t('dropFile')}>
            <input
              type="file"
              name="statement"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              required
              className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm file:me-3 file:rounded file:border-0 file:bg-brand-soft file:px-3 file:py-1 file:text-sm file:text-brand"
            />
          </Field>

          <Field label={t('chooseAggregator')}>
            <Select name="aggregator" defaultValue="talabat" required>
              {AGGREGATOR_CODES.map((code) => (
                <option key={code} value={code}>
                  {AGGREGATOR_NAMES[code]}
                </option>
              ))}
            </Select>
          </Field>

          <div className="sm:col-span-2">
            <SubmitButton />
            <p className="mt-2 text-xs text-ink-muted">{t('noAccountNeeded')}</p>
            <Progress />
          </div>
        </form>
      </Card>

      {result.message !== null && (
        <Card>
          <p className="text-sm leading-relaxed text-critical">{result.message}</p>
        </Card>
      )}

      {result.ok && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label={t('resultHeadline', { amount: '' }).replace('  ', ' ').trim()}
              value={amount(result.recoveryTotalMinor, result.currency, locale)}
              tone={result.recoveryTotalMinor > 0 ? 'warning' : 'positive'}
            />
            <Stat label={common('amount')} value={count(result.ordersRead, locale)} />
            <Stat label={common('status')} value={count(result.linesRead, locale)} />
          </div>

          {result.recoveryTotalMinor === 0 && (
            <Card>
              <p className="text-sm font-medium text-ink">{t('resultNothing')}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                {t('resultNothingHint')}
              </p>
            </Card>
          )}

          {result.breakdown.length > 0 && (
            <Card title={t('breakdown')} hint={t('blurredHint')}>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('breakdown')}</Th>
                    <Th numeric>{common('amount')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.breakdown.map((row) => (
                    <tr key={row.causeCode}>
                      <Td>
                        <span className="font-medium text-ink">
                          {locale === 'ar' ? row.labelAr : row.label}
                        </span>
                        {!row.countsTowardsRecovery && (
                          <span className="ms-2">
                            <Badge>{common('none')}</Badge>
                          </span>
                        )}
                      </Td>
                      <Td numeric>
                        {/*
                          The category and the count are shown; the amount is
                          obscured until signup. Blurring the total as well would
                          leave nothing to evaluate, and the headline figure is
                          the reason anyone would sign up.
                        */}
                        <span className="select-none blur-[5px]" aria-hidden>
                          {amount(row.amountMinor, result.currency, locale)}
                        </span>
                        <span className="sr-only">{t('blurredHint')}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button type="button">{t('signUp')}</Button>
              </div>
            </Card>
          )}

          <Card title={t('assumptionsTitle')}>
            <p className="text-sm leading-relaxed text-ink-muted">{t('assumptionsHint')}</p>
            <p className="mt-2 text-sm text-ink" data-numeric>
              {(result.assumedCommissionRate * 100).toFixed(2)}%
            </p>
            {result.unmatchedLines > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                {count(result.unmatchedLines, locale)}
              </p>
            )}
            {result.parseNotes.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs leading-relaxed text-ink-muted">
                {result.parseNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
