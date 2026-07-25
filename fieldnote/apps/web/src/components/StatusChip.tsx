import { useTranslations } from 'next-intl';
import type { ReportStatus } from '@fieldnote/shared';

/**
 * Report status chip.
 *
 * Only `needs_review` is coloured. A dashboard where every row shouts tells the
 * reviewer nothing about where to start, and "which of tonight's reports needs
 * me" is the only question this screen exists to answer.
 */
const STYLES: Record<ReportStatus, string> = {
  draft: 'bg-neutral-100 text-ink-muted',
  processing: 'bg-neutral-100 text-ink-muted',
  needs_review: 'bg-amber-bg text-amber-text ring-1 ring-inset ring-amber-border',
  ready: 'bg-emerald-50 text-emerald-800',
  sent: 'bg-neutral-100 text-ink-faint',
};

export function StatusChip({ status }: { status: ReportStatus }) {
  const t = useTranslations('status');

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status === 'processing' && (
        <span
          className="me-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current"
          aria-hidden="true"
        />
      )}
      {t(status)}
    </span>
  );
}
