'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionResult } from '@/app/[locale]/settings/actions';
import { Button, cx } from './ui';

const INITIAL: ActionResult = { ok: false, message: '' };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {label}
    </Button>
  );
}

/**
 * A form wired to a server action, showing what the action actually said.
 *
 * The alternative — passing a server action straight to `action=` and letting it
 * return nothing — throws away the message. That matters here more than in most
 * forms: the action can reject a commission rate because its dates overlap an
 * existing one, and "nothing happened" is a terrible way to communicate that.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
}: {
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const [state, dispatch] = useActionState(action, INITIAL);

  return (
    <form action={dispatch} className={cx('grid gap-4', className)}>
      {children}
      <div className="sm:col-span-4">
        <Submit label={submitLabel} />
        {state.message !== '' && (
          <p
            role="status"
            className={cx(
              'mt-2 text-xs leading-relaxed',
              state.ok ? 'text-positive' : 'text-critical',
            )}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
