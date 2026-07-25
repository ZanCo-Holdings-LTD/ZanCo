import type { ReactNode } from 'react';

/**
 * A small UI kit, written into the repo rather than installed.
 *
 * This is what shadcn/ui is: components you own, in your own source tree, not a
 * dependency you upgrade. Keeping them here means the RTL behaviour and the
 * numeric formatting rules below are ours to guarantee rather than something to
 * re-audit after every upstream release.
 *
 * Every class here uses logical properties, so the whole app flips under
 * `dir="rtl"` without a single conditional.
 */

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function Card({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        className,
      )}
    >
      {(title !== undefined || action !== undefined) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title !== undefined && (
              <h2 className="text-sm font-semibold text-ink">{title}</h2>
            )}
            {hint !== undefined && (
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/**
 * A headline figure.
 *
 * `data-numeric` forces LTR on the value itself. Without it, an amount inside an
 * RTL paragraph can have its minus sign moved by the bidi algorithm, and a
 * misplaced minus on a settlement figure is not cosmetic.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'positive' | 'warning' | 'critical';
}) {
  const toneClass = {
    neutral: 'text-ink',
    positive: 'text-positive',
    warning: 'text-warning',
    critical: 'text-critical',
  }[tone];

  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cx('mt-2 text-2xl font-semibold', toneClass)} data-numeric>
        {value}
      </p>
      {hint !== undefined && (
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'warning' | 'critical' | 'brand';
}) {
  const toneClass = {
    neutral: 'bg-surface-sunken text-ink-muted border-line',
    positive: 'bg-positive-soft text-positive border-positive/20',
    warning: 'bg-warning-soft text-warning border-warning/20',
    critical: 'bg-critical-soft text-critical border-critical/20',
    brand: 'bg-brand-soft text-brand border-brand/20',
  }[tone];

  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

export function Table({ children }: { children: ReactNode }) {
  // The wrapper scrolls, not the page. A wide statement table must never make
  // the whole document scroll sideways.
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[40rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  numeric = false,
}: {
  children: ReactNode;
  numeric?: boolean;
}) {
  return (
    <th
      className={cx(
        'border-b border-line pb-2 text-xs font-medium uppercase tracking-wide text-ink-muted',
        numeric ? 'text-end' : 'text-start',
      )}
      scope="col"
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric = false,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cx(
        'border-b border-line py-3 align-top',
        numeric ? 'text-end tabular-nums' : 'text-start',
        className,
      )}
      {...(numeric ? { 'data-numeric': '' } : {})}
    >
      {children}
    </td>
  );
}

export function EmptyState({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-5 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint !== undefined && (
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink">{label}</span>
      {children}
      {hint !== undefined && (
        <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{hint}</span>
      )}
    </label>
  );
}

const CONTROL =
  'mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink-muted focus:border-brand focus:outline-none';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(CONTROL, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(CONTROL, props.className)} />;
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const variantClass = {
    primary: 'bg-brand text-white hover:opacity-90',
    secondary: 'border border-line bg-surface text-ink hover:bg-surface-sunken',
    ghost: 'text-brand hover:bg-brand-soft',
  }[variant];

  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium',
        'transition disabled:cursor-not-allowed disabled:opacity-50',
        variantClass,
        className,
      )}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle !== undefined && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{subtitle}</p>
        )}
      </div>
      {action}
    </header>
  );
}
