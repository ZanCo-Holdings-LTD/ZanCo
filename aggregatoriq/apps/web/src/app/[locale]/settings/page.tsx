import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VAT_TREATMENTS } from '@aggregatoriq/core';
import { publicEnv } from '@/env';
import { guard } from '@/components/guard';
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { settingsData } from '@/lib/queries';
import { amount, percent, plainDate } from '@/lib/format';
import {
  createAggregatorAccountAction,
  createBranchAction,
  updateMaterialityAction,
} from './actions';

const TIMEZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Europe/London',
];

const CURRENCIES = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'GBP'];

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('settings');
  const common = await getTranslations('common');

  const resolved = await guard();
  if (!resolved.ok) return resolved.node;

  const membership = resolved.membership;
  const { branches, aggregators, accounts, members, addresses } = await settingsData(membership);
  const emailDomain = publicEnv().NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN;

  const branchName = (id: string): string =>
    branches.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');
  const aggregatorName = (id: string): string =>
    aggregators.find((candidate) => candidate.id === id)?.name ?? common('notAvailable');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={membership.orgName} />

      <Card title={t('branches')}>
        {branches.length === 0 ? (
          <EmptyState title={common('empty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('branchName')}</Th>
                <Th>{t('city')}</Th>
                <Th>{t('timezone')}</Th>
                <Th>{t('currency')}</Th>
                <Th>{t('ingestionEmail')}</Th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => {
                const branchAddresses = addresses.filter(
                  (address) => address.branchId === branch.id,
                );
                return (
                  <tr key={branch.id}>
                    <Td>{branch.name}</Td>
                    <Td>{branch.city ?? common('notAvailable')}</Td>
                    <Td>
                      <span data-numeric>{branch.timezone}</span>
                    </Td>
                    <Td>
                      <span data-numeric>{branch.currency}</span>
                    </Td>
                    <Td>
                      {branchAddresses.length === 0 ? (
                        common('notAvailable')
                      ) : (
                        <ul className="space-y-1">
                          {branchAddresses.map((address) => (
                            <li key={address.localPart}>
                              <code className="text-xs" data-numeric>
                                {address.localPart}@{emailDomain}
                              </code>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        <ActionForm
          action={createBranchAction}
          submitLabel={t('addBranch')}
          className="mt-6 sm:grid-cols-4"
        >
          <Field label={t('branchName')}>
            <Input name="name" required />
          </Field>
          <Field label={t('city')}>
            <Input name="city" />
          </Field>
          <Field label={t('timezone')} hint={t('timezoneHint')}>
            <Select name="timezone" defaultValue="Asia/Riyadh">
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('currency')}>
            <Select name="currency" defaultValue={membership.baseCurrency}>
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>
        </ActionForm>
      </Card>

      <Card title={t('aggregatorAccounts')} hint={t('effectiveHint')}>
        {accounts.length === 0 ? (
          <EmptyState title={common('empty')} hint={t('commissionRateHint')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{common('branch')}</Th>
                <Th>{common('aggregator')}</Th>
                <Th>{t('storeId')}</Th>
                <Th numeric>{t('commissionRate')}</Th>
                <Th>{t('vatTreatment')}</Th>
                <Th numeric>{t('payoutCycle')}</Th>
                <Th>{t('effectiveFrom')}</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <Td>{branchName(account.branchId)}</Td>
                  <Td>{aggregatorName(account.aggregatorId)}</Td>
                  <Td>
                    <span data-numeric>{account.externalStoreId}</span>
                  </Td>
                  <Td numeric>{percent(account.contractedCommissionRate, locale)}</Td>
                  <Td>{t(`vat.${account.vatTreatment}`)}</Td>
                  <Td numeric>{account.payoutCycleDays}</Td>
                  <Td>
                    {plainDate(account.effectiveFrom, locale)}
                    {account.effectiveTo === null ? (
                      <span className="ms-2">
                        <Badge tone="positive">{common('all')}</Badge>
                      </span>
                    ) : (
                      <span className="block text-xs text-ink-muted">
                        → {plainDate(account.effectiveTo, locale)}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <ActionForm
          action={createAggregatorAccountAction}
          submitLabel={t('addAccount')}
          className="mt-6 sm:grid-cols-4"
        >
          <Field label={common('branch')}>
            <Select name="branchId" required>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={common('aggregator')}>
            <Select name="aggregatorId" required>
              {aggregators.map((aggregator) => (
                <option key={aggregator.id} value={aggregator.id}>
                  {aggregator.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('storeId')}>
            <Input name="externalStoreId" required />
          </Field>
          <Field label={t('commissionRate')} hint={t('commissionRateHint')}>
            <Input name="commissionPercent" type="number" step="0.01" min="0" max="100" required />
          </Field>
          <Field label={t('vatTreatment')}>
            <Select name="vatTreatment" defaultValue="commission_on_net">
              {VAT_TREATMENTS.map((treatment) => (
                <option key={treatment} value={treatment}>
                  {t(`vat.${treatment}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('payoutCycle')}>
            <Input name="payoutCycleDays" type="number" min="1" max="120" defaultValue={14} />
          </Field>
          <Field label={t('deliveryFeeBearer')}>
            <Select name="deliveryFeeBearer" defaultValue="customer">
              {(['aggregator', 'operator', 'customer'] as const).map((bearer) => (
                <option key={bearer} value={bearer}>
                  {t(`bearer.${bearer}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('effectiveFrom')} hint={t('effectiveHint')}>
            <Input name="effectiveFrom" type="date" required />
          </Field>
        </ActionForm>
      </Card>

      <Card title={t('materiality')} hint={t('materialityHint')}>
        <ActionForm
          action={updateMaterialityAction}
          submitLabel={common('save')}
          className="sm:grid-cols-4"
        >
          <Field label={t('materiality')}>
            <Input
              name="materialityMinor"
              type="number"
              min="0"
              defaultValue={membership.materialityThresholdMinor}
            />
          </Field>
          <p className="self-end text-xs text-ink-muted">
            {amount(membership.materialityThresholdMinor, membership.baseCurrency, locale)}
          </p>
        </ActionForm>
      </Card>

      <Card title={t('team')}>
        <Table>
          <thead>
            <tr>
              <Th>{t('team')}</Th>
              <Th>{common('status')}</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <Td>
                  {member.fullName ?? member.email}
                  <span className="mt-1 block text-xs text-ink-muted" data-numeric>
                    {member.email}
                  </span>
                </Td>
                <Td>
                  <Badge tone={member.role === 'owner' ? 'brand' : 'neutral'}>{member.role}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
