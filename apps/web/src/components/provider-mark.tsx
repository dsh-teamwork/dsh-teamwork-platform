import { markInitials, PROVIDER_MARKS, providerMark } from '@dsh-teamwork/shared';

import { cn } from '@/lib/utils';

/**
 * A model's or provider's mark on a tile, wherever the console names one: the
 * maker's logo when `providerMark` recognises one of `hints` (what names the
 * model first, then where it is called), else up to two letters of `name`.
 * Decorative: the name beside it is what a reader and a screen reader read.
 */
export function ProviderMark({ hints, name, size = 'sm', className }: {
  hints: (string | null | undefined)[];
  /** What the initials are taken from when no mark is known. */
  name: string;
  /** `sm` sits in a line of text or a menu; `md` heads a card. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const mark = providerMark(...hints);
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center bg-secondary text-foreground', size === 'md' ? 'size-9 rounded-lg' : 'size-5 rounded-sm', className)}>
      {mark ? (
        <svg viewBox="0 0 24 24" className={size === 'md' ? 'size-5' : 'size-3.5'} fill="currentColor">
          {PROVIDER_MARKS[mark].map((path: { d: string; faded?: true }) => (
            <path key={path.d} d={path.d} fillRule="evenodd" clipRule="evenodd" fillOpacity={path.faded ? 0.5 : undefined} />
          ))}
        </svg>
      ) : (
        <span className={cn('font-bold text-muted-foreground', size === 'md' ? 'text-xs' : 'text-[9px] leading-none')}>{markInitials(name)}</span>
      )}
    </span>
  );
}
