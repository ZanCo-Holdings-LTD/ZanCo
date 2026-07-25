import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuditForm } from '@/components/audit-form';
import { PageHeader } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'audit' });
  return { title: t('title'), description: t('subtitle') };
}

/**
 * The free audit: public, no account, no card.
 *
 * This is the funnel rather than a marketing page. Someone with a statement and
 * a suspicion gets a real number computed by the real engine — not an
 * illustration, not a lead form.
 */
export default async function AuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('audit');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AuditForm />
    </div>
  );
}
