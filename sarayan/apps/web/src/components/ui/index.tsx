import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * UI primitives.
 *
 * shadcn/ui-shaped, hand-written so every rule uses logical properties. There
 * is no `ml-`, `pr-` or `left-` anywhere in the component layer — that is what
 * makes the Arabic build a genuine mirror rather than a patched LTR layout.
 */

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-700 text-white hover:bg-brand-800 dark:bg-brand-600 dark:hover:bg-brand-500",
        secondary:
          "bg-white text-ink-800 ring-1 ring-ink-200 hover:bg-ink-50 dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-700 dark:hover:bg-ink-700",
        ghost: "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800",
        danger: "bg-danger-mid text-white hover:bg-danger-deep",
        link: "text-brand-700 underline underline-offset-4 hover:text-brand-800 dark:text-brand-400",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-card border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn("text-base font-semibold tracking-tight text-ink-900 dark:text-ink-50", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-ink-500 dark:text-ink-400", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-3 border-t border-ink-100 p-5 dark:border-ink-800", className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("block text-sm font-medium text-ink-700 dark:text-ink-300", className)}
      {...props}
    />
  );
}

const fieldStyles =
  "block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 shadow-sm transition-shadow placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50 disabled:text-ink-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:placeholder:text-ink-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldStyles, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldStyles, "min-h-24 resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldStyles, "h-10 pe-8", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ms-1 text-danger-mid">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-danger-deep dark:text-danger-mid">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-500 dark:text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300",
        valid: "bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200",
        due_soon: "bg-amber-soft text-amber-deep dark:bg-amber-deep/25 dark:text-amber-soft",
        critical: "bg-amber-soft text-amber-deep dark:bg-amber-deep/30 dark:text-amber-soft",
        expired: "bg-danger-soft text-danger-deep dark:bg-danger-deep/30 dark:text-danger-soft",
        dormant: "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400",
        brand: "bg-brand-700 text-white",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** A coloured dot for status. Critical and expired also carry a ring, so the
 * state survives colour-blindness and greyscale printing. */
export function StatusDot({ status }: { status: string }) {
  const tone =
    status === "expired"
      ? "bg-danger-mid ring-2 ring-danger-mid/30"
      : status === "critical"
        ? "bg-amber-mid ring-2 ring-amber-mid/30"
        : status === "due_soon"
          ? "bg-amber-mid"
          : status === "valid"
            ? "bg-brand-500"
            : "bg-ink-300";
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", tone)} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-ink-200 px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:text-ink-400",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn("border-b border-ink-100 px-3 py-3 align-middle dark:border-ink-800/70", className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-ink-200 bg-ink-50 text-ink-700 dark:border-ink-700 dark:bg-ink-800/60 dark:text-ink-200",
    warning: "border-amber-mid/40 bg-amber-soft text-amber-deep dark:bg-amber-deep/20 dark:text-amber-soft",
    danger: "border-danger-mid/40 bg-danger-soft text-danger-deep dark:bg-danger-deep/20 dark:text-danger-soft",
    success: "border-brand-300 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200",
  } as const;

  return (
    <div className={cn("rounded-lg border p-3 text-sm", tones[tone], className)} role="status">
      {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-ink-200 px-6 py-14 text-center dark:border-ink-700">
      <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{title}</p>
      {body ? <p className="max-w-sm text-sm text-ink-500 dark:text-ink-400">{body}</p> : null}
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-50">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

/** Numbers, dates and reference codes stay LTR even inside Arabic text. */
export function Numeral({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("ltr-numeral", className)}>{children}</span>;
}
