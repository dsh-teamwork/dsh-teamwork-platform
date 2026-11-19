import { markGradient, markInitials, PROVIDER_MARKS, providerMark, type MarkArt, type ProviderMark as Mark } from '@dsh-teamwork/shared';
import { useId, type SVGProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A model's or provider's mark on its plate, wherever the console names one:
 * the maker's logo in its own colours when `providerMark` recognises one of
 * `hints` (what names the model first, then where it is called), else up to
 * two letters of `name` on the quiet tile. The plate is `--mark-plate`, light
 * in both themes, so a dark brand colour stays legible in dark mode.
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
    <span aria-hidden className={cn('grid shrink-0 place-items-center', mark ? 'bg-mark-plate' : 'bg-secondary', size === 'md' ? 'size-9 rounded-lg' : 'size-5 rounded-sm', className)}>
      {mark ? (
        <MarkSvg mark={mark} className={size === 'md' ? 'size-5' : 'size-3.5'} />
      ) : (
        <span className={cn('font-bold text-muted-foreground', size === 'md' ? 'text-xs' : 'text-[9px] leading-none')}>{markInitials(name)}</span>
      )}
    </span>
  );
}

/** One mark as an `<svg>` in its own colours, its gradients named per instance so two on a page never share one. */
export function MarkSvg({ mark, ...props }: { mark: Mark } & SVGProps<SVGSVGElement>) {
  const id = useId();
  const art: MarkArt = PROVIDER_MARKS[mark];
  const paint = (fill: string) => {
    const gradient = markGradient(fill);
    return gradient === undefined ? fill : `url(#${id}-${gradient})`;
  };
  return (
    <svg viewBox="0 0 24 24" {...props}>
      {art.gradients && (
        <defs>
          {art.gradients.map((g, i) => (
            <linearGradient key={i} id={`${id}-${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} gradientUnits={g.userSpace ? 'userSpaceOnUse' : undefined}>
              {g.stops.map((stop, j) => <stop key={j} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}
            </linearGradient>
          ))}
        </defs>
      )}
      {art.shapes.map((shape, i) =>
        shape.circle ? (
          <circle key={i} cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} fill={paint(shape.fill)} />
        ) : (
          <path key={i} d={shape.d} fill={paint(shape.fill)} fillRule={shape.evenOdd ? 'evenodd' : undefined} clipRule={shape.evenOdd ? 'evenodd' : undefined} />
        ),
      )}
    </svg>
  );
}
