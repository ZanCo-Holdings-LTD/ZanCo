'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { flagFor, isTouched, type SourceSpan } from '@fieldnote/shared';

/**
 * One reviewable field.
 *
 * This component carries the product's core promise: every generated value
 * shows the words it came from, and a value the model was unsure about cannot
 * reach a client until a human has looked at it.
 *
 * There are two ways to clear the amber state, and keeping them separate
 * matters. Editing means the model was wrong; confirming means it was right.
 * Collapsing both into one "acknowledge" button would destroy the edit-distance
 * signal that tells us whether the product is actually improving.
 */

export interface FieldRowProps {
  reportId: string;
  fieldId: string;
  label: string;
  type: string;
  required: boolean;
  enumValues: string[] | null;
  value: unknown;
  generatedValue: unknown;
  confidence: number | null;
  sourceSpan: SourceSpan | null;
  editedByHuman: boolean;
  reviewedAt: string | null;
  onSeek?: (span: SourceSpan) => void;
}

export function FieldRow(props: FieldRowProps) {
  const t = useTranslations('review');
  const [value, setValue] = useState(toText(props.value));
  const [reviewedAt, setReviewedAt] = useState(props.reviewedAt);
  const [edited, setEdited] = useState(props.editedByHuman);
  const [showSource, setShowSource] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const flag = flagFor({ value: props.value, confidence: props.confidence });
  const touched = isTouched({ editedByHuman: edited, reviewedAt });
  const isAmber = flag === 'amber' && !touched;
  const missingRequired = props.required && flag === 'empty';

  async function persist(action: 'edit' | 'confirm', nextValue?: string) {
    setError(null);
    const response = await fetch(`/api/reports/${props.reportId}/values/${props.fieldId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'edit' ? { action, value: nextValue } : { action }),
    });

    if (!response.ok) {
      // Leave the local edit in place so the reviewer does not lose their
      // typing; blurring the field again retries.
      setError('Could not save. Your text is still here — try again.');
      return;
    }

    setReviewedAt(new Date().toISOString());
    if (action === 'edit') setEdited(true);
  }

  function handleBlur() {
    if (value === toText(props.value)) return;
    startTransition(() => void persist('edit', value));
  }

  return (
    <div
      className={`rounded-md p-3 transition ${isAmber ? 'amber-field' : 'border-s-4 border-transparent'}`}
      data-amber={isAmber || undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={props.fieldId}
          className="text-xs font-medium uppercase tracking-wide text-ink-muted"
        >
          {props.label}
          {props.required && (
            <span className="ms-1 text-ink-faint" aria-hidden="true">
              *
            </span>
          )}
        </label>

        <div className="flex shrink-0 items-center gap-2 text-xs">
          {edited && <Badge>{t('editedBadge')}</Badge>}
          {!edited && reviewedAt && <Badge>{t('confirmedBadge')}</Badge>}
        </div>
      </div>

      {props.enumValues ? (
        <select
          id={props.fieldId}
          value={value}
          disabled={pending}
          onChange={(event) => {
            setValue(event.target.value);
            startTransition(() => void persist('edit', event.target.value));
          }}
          className="mt-1.5 w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm"
        >
          <option value="">—</option>
          {props.enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : props.type === 'long_text' ? (
        <textarea
          id={props.fieldId}
          value={value}
          rows={Math.max(3, Math.ceil(value.length / 90))}
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
          onBlur={handleBlur}
          className="mt-1.5 w-full resize-y rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm leading-relaxed"
        />
      ) : (
        <input
          id={props.fieldId}
          type={props.type === 'number' ? 'number' : 'text'}
          value={value}
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
          onBlur={handleBlur}
          className="mt-1.5 w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm"
        />
      )}

      {missingRequired && <p className="mt-1.5 text-xs text-ink-muted">{t('emptyRequired')}</p>}

      {isAmber && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-xs text-amber-text">{t('amberHint')}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => void persist('confirm'))}
            className="rounded border border-amber-border bg-white px-2 py-1 text-xs font-medium text-amber-text hover:bg-amber-bg"
          >
            {t('confirm')}
          </button>
        </div>
      )}

      {/* Tap-through to the source. This is what makes the report defensible:
          the reviewer never has to take a generated value on trust. */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {props.sourceSpan ? (
          <>
            <button
              type="button"
              onClick={() => setShowSource((open) => !open)}
              aria-expanded={showSource}
              className="text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              {t('sourceLabel')}
            </button>
            {props.onSeek && (
              <button
                type="button"
                onClick={() => props.onSeek?.(props.sourceSpan!)}
                className="text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                {t('playAudio')}
              </button>
            )}
          </>
        ) : (
          flag !== 'empty' && <span className="text-ink-faint">{t('noSource')}</span>
        )}
      </div>

      {showSource && props.sourceSpan && (
        <blockquote className="mt-2 border-s-2 border-neutral-300 ps-3 text-sm italic text-ink-muted">
          {`“${props.sourceSpan.quote}”`}
        </blockquote>
      )}

      {/* Shown only once a human has changed it, so the original draft is
          recoverable without competing for attention during review. */}
      {edited && props.generatedValue !== null && (
        <details className="mt-2 text-xs text-ink-faint">
          <summary className="cursor-pointer">{t('generatedLabel')}</summary>
          <p className="mt-1 whitespace-pre-wrap">{toText(props.generatedValue)}</p>
        </details>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-ink-muted">{children}</span>;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
