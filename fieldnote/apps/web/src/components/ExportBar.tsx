'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * The export gate, made visible.
 *
 * Pinned to the bottom of the review workspace so the reviewer always knows how
 * far they have to go. When export is blocked it says exactly what is blocking
 * it and offers to jump to the next unchecked field — a disabled button with no
 * explanation is how people conclude the software is broken.
 *
 * This is a convenience, not a control. The server re-evaluates the same gate
 * before rendering, so a crafted request cannot skip it.
 */
export function ExportBar({
  reportId,
  canExport,
  untouchedAmberCount,
  latestVersion,
}: {
  reportId: string;
  canExport: boolean;
  untouchedAmberCount: number;
  latestVersion: number | null;
}) {
  const t = useTranslations('review');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function jumpToNextAmber() {
    const next = document.querySelector<HTMLElement>(
      '[data-amber] input, [data-amber] textarea, [data-amber] select',
    );
    next?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    next?.focus({ preventScroll: true });
  }

  async function requestExport() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/export`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? 'Export failed');
        return;
      }
      // Rendering happens in the worker; the page reflects the new version
      // once the job completes.
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="no-print fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <div className="min-w-0 text-sm">
          {canExport ? (
            <p className="text-emerald-800">{t('exportReady')}</p>
          ) : (
            <button
              type="button"
              onClick={jumpToNextAmber}
              className="text-start text-amber-text underline underline-offset-2"
            >
              {t('exportBlocked', { count: untouchedAmberCount })}
            </button>
          )}
          {latestVersion !== null && (
            <p className="mt-0.5 text-xs text-ink-faint">v{latestVersion}</p>
          )}
          {error && <p className="mt-0.5 text-xs text-red-700">{error}</p>}
        </div>

        <button
          type="button"
          disabled={!canExport || pending}
          onClick={() => void requestExport()}
          className="shrink-0 rounded bg-ink px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-ink-faint"
        >
          {t('export')}
        </button>
      </div>
    </div>
  );
}
