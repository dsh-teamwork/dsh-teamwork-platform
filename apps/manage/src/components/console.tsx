import { t } from '../lib/copy';
import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Presentational building blocks shared by every admin page.
 *
 * These encode *this console's* conventions — how a page header looks, how a
 * KPI reads, how an empty table says it is empty — so pages stay short and stay
 * consistent with each other. Server-component-safe: no hooks, no client APIs.
 */

/* ── Page chrome ─────────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional "up one level" link rendered as an eyebrow above the title. */
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-wrap items-start justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0">
        {back && (
          <Link
            to={back.href}
            className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {description != null && (
          <div className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions != null && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** Section heading inside a page, above a card grid, a filter bar or a list. */
export function SectionHeading({
  children,
  aside,
  className,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-3 flex items-baseline justify-between gap-3',
        className,
      )}
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      {aside != null && (
        <div className="text-sm text-muted-foreground">{aside}</div>
      )}
    </div>
  );
}

/** Bordered container matching the console's card treatment. */
export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card p-4', className)}
    >
      {children}
    </div>
  );
}

/* ── Form controls ───────────────────────────────────────────────────────── */

/*
 * Shared control classes. Every page used to redeclare its own `const input =
 * "…"`, which is how the console ended up with three input heights and a focus
 * ring on roughly half of its filter boxes. Import these instead; a control
 * that needs to differ composes with `cn()`.
 */

/** Filter-bar sized input/select — the dense controls above a table. */
export const CONTROL =
  'rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** Form-sized input/select/textarea — the controls inside a dialog or a form. */
export const CONTROL_LG =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** Neutral bordered button — the default for anything that is not the one CTA. */
export const BUTTON =
  'rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-50';

/** The dense variant, for filter bars and per-row actions. */
export const BUTTON_SM =
  'rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50';

/**
 * The one CTA on a form. Deliberately `primary` (near-black / near-white) and
 * not the brand: the brand is chrome, and a page full of brand-coloured
 * buttons stops any one of them reading as *the* action.
 */
export const BUTTON_PRIMARY =
  'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50';

/* ── Feedback ────────────────────────────────────────────────────────────── */

/**
 * Inline error strip. Rendered *above* the data rather than replacing it, so a
 * failed refresh does not blank out a table the operator was reading.
 */
export function ErrorBanner({
  error,
  className,
}: {
  error: Error | string | undefined | null;
  className?: string;
}) {
  if (!error) return null;
  return (
    <p
      className={cn(
        'mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive',
        className,
      )}
    >
      {typeof error === 'string' ? error : error.message}
    </p>
  );
}

/** Centred placeholder for a table/grid with nothing in it (or still loading). */
export function EmptyState({
  loading,
  message,
  loadingMessage = t('loading'),
  className,
}: {
  loading?: boolean;
  message: string;
  loadingMessage?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'py-12 text-center text-sm text-muted-foreground',
        className,
      )}
    >
      {loading ? loadingMessage : message}
    </div>
  );
}

/**
 * Fallback for a page's `<Suspense>` boundary — the real header with the body
 * still loading, so the page does not pop its title in on hydration.
 */
export function PageSkeleton({
  title,
  description,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState loading message="" />
    </div>
  );
}

/* ── Metrics ─────────────────────────────────────────────────────────────── */

export type Tone = 'default' | 'positive' | 'negative' | 'warning' | 'brand';

const VALUE_TONE: Record<Tone, string> = {
  default: 'text-foreground',
  positive: 'text-success',
  negative: 'text-destructive',
  warning: 'text-warning',
  brand: 'text-brand',
};

/**
 * A single headline number. Optionally a link — a KPI that names a filtered
 * view should take you there, which is most of what a dashboard is for.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  icon: Icon,
  href,
  className,
}: {
  label: React.ReactNode;
  value: string | number;
  sub?: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      <p className={cn('tabular mt-1 text-2xl font-bold', VALUE_TONE[tone])}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub != null && (
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      )}
    </>
  );

  const classes = cn(
    'block rounded-lg border border-border bg-card p-4 transition-colors',
    href && 'hover:border-brand/60',
    className,
  );

  return href ? (
    <Link to={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** Scroll container + border for a table, so wide tables never widen the page. */
export function TableShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border border-border',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Pagination ──────────────────────────────────────────────────────────── */

/**
 * Footer for a paginated list. Prev/Next are rendered by the caller so each
 * page can choose links (URL-backed, via `PagerLinks`) or buttons (local state).
 */
export function PaginationBar({
  page,
  totalPages,
  total,
  noun,
  children,
  className,
}: {
  page: number;
  totalPages: number;
  total?: number;
  /** Plural noun for the count, e.g. "requests". */
  noun: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div
      className={cn('mt-4 flex items-center justify-between gap-3', className)}
    >
      <p className="tabular text-sm text-muted-foreground">
        {total != null ? `${total.toLocaleString()} ${noun} — ` : ''}page {page}{' '}
        of {totalPages}
      </p>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
