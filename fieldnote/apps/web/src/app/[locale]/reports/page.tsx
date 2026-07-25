import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { repositories } from '@fieldnote/db';
import { REPORT_STATUSES, type ReportStatus } from '@fieldnote/shared';
import { Link } from '@/i18n/routing';
import { getSession, query } from '@/lib/session';
import { StatusChip } from '@/components/StatusChip';

/**
 * Reports dashboard.
 *
 * The evening screen. A surveyor opens this after a day on site and needs one
 * question answered: which of today's reports is waiting for me. Everything
 * else is secondary, which is why `needs_review` is the only chip with colour
 * and why the default sort is newest first rather than by status.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect('/sign-in');

  const filters = await searchParams;
  const status = REPORT_STATUSES.includes(filters.status as ReportStatus)
    ? (filters.status as ReportStatus)
    : undefined;

  const [reports, counts] = await query(session, async (tx) => [
    await repositories.reports.list(tx, session.orgId, { status, search: filters.q }),
    await repositories.reports.statusCounts(tx, session.orgId),
  ]);

  const t = await getTranslations('dashboard');
  const tStatus = await getTranslations('status');
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

  const isFiltered = Boolean(status || filters.q);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('subtitle')}</p>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2" aria-label={t('columns.status')}>
        {REPORT_STATUSES.map((value) => (
          <Link
            key={value}
            href={value === status ? '/reports' : `/reports?status=${value}`}
            aria-current={value === status ? 'page' : undefined}
            className={`rounded-full px-3 py-1 text-sm transition ${
              value === status
                ? 'bg-ink text-white'
                : 'bg-white text-ink-muted ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50'
            }`}
          >
            {tStatus(value)}
            <span className="ms-1.5 tabular-nums opacity-60">{counts[value]}</span>
          </Link>
        ))}
      </nav>

      {reports.length === 0 ? (
        <EmptyState filtered={isFiltered} />
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg bg-white ring-1 ring-neutral-200">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={`/reports/${report.id}`}
                className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-neutral-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{report.propertyAddress}</p>
                  <p className="mt-0.5 truncate text-sm text-ink-muted">
                    {[report.clientName, report.reference].filter(Boolean).join(' · ') ||
                      report.templateName}
                  </p>
                </div>
                <time
                  className="hidden shrink-0 text-sm tabular-nums text-ink-faint sm:block"
                  dateTime={(report.inspectedAt ?? report.createdAt).toISOString()}
                >
                  {format.format(report.inspectedAt ?? report.createdAt)}
                </time>
                <StatusChip status={report.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

async function EmptyState({ filtered }: { filtered: boolean }) {
  const t = await getTranslations(filtered ? 'dashboard.emptyFiltered' : 'dashboard.empty');

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
      <h2 className="text-lg font-medium">{t('title')}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">{t('body')}</p>
    </div>
  );
}
