import { createTranslator } from 'use-intl';

import { MarkSvg } from '@/components/provider-mark';
import type { Locale } from '@/lib/locale';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';

/*
 * The home page's team diagram (docs/design.md, "The landing page's
 * first screen"): how a team uses DSH Teamwork, left to right. On the left,
 * the people and where each one works (DSH Desktop, a terminal, the phone, the
 * admin's web console); in the middle, the one place that governs and syncs,
 * its name over the page's sections ticked off as what it does;
 * on the right, the mainstream providers it forwards calls to, each by its
 * logo on its plate (`MarkSvg`), and Cloud DSH as a separate workspace.
 *
 * The value is shown rather than labelled. A pulse plays the story on a loop
 * (globals.css, "topology"): the admin publishes, the hub syncs it to every
 * member, whose cards tick, then a member's call goes through the hub to a
 * model. Hovering one of the hub's features dims everything it does not
 * involve (`data-f` names the features each part belongs to). Both are CSS,
 * since this page runs no React, and motion stops under reduced motion. Anthropic is
 * reached through OpenRouter or a custom address, as the console's catalogue
 * says (lib/provider-catalog.ts). Inline SVG drawn from the theme's tokens, so
 * it follows light and dark; the other icons are lucide's, at their 24-unit
 * size.
 */

const ICONS = {
  laptop: <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16" />,
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </>
  ),
  // The phone carries the app's own logo on its screen: the app is ours (docs/design.md, the logo is an image).
  phone: (
    <>
      {/* Larger than lucide's 24-unit box, into the tile's padding, so the logo on its screen reads. */}
      <rect width="19" height="28" x="2.5" y="-2" rx="3.5" className="fill-background" />
      <image href="/logo.svg" x="4.5" y="4.5" width="15" height="15" />
    </>
  ),
  console: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
};

/** The mainstream providers, by logo, then any other address the admin adds. */
const PROVIDERS = ['anthropic', 'openai', 'deepseek', 'zhipu', 'kimi'] as const;

/** A curve leaving one side horizontally and arriving at the other horizontally. */
const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const m = (x1 + x2) / 2;
  return `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
};

// Three columns: the people, the hub, and the providers above Cloud DSH.
const WIDTH = 760;
const LEFT = 4;
const NODE_WIDTH = 192;
const HUB = { x: 296, y: 82, width: 200, height: 268 } as const;
const RIGHT = 600;
const RIGHT_WIDTH = 156;
const UPSTREAM = { y: 62, height: 232 } as const;
const CLOUD_Y = UPSTREAM.y + UPSTREAM.height + 22;
const ROW = 28;

function Icon({ name, x, y }: { name: keyof typeof ICONS; x: number; y: number }) {
  return (
    <g className="topology-icon">
      <rect x={x} y={y} width={38} height={38} rx={10} className="fill-muted stroke-border" />
      <g transform={`translate(${x + 8} ${y + 8}) scale(0.92)`} className="fill-none stroke-foreground" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </g>
    </g>
  );
}

function Node({ x, y, width = NODE_WIDTH, icon, who, where, admin, synced, f }: {
  x: number; y: number; width?: number; icon: keyof typeof ICONS; who: string; where: string; admin?: boolean;
  /** Ticks when the pulse's sync reaches this card. */
  synced?: boolean;
  /** The hub features this node belongs to, for the hover highlight. */
  f: string;
}) {
  return (
    <g data-f={f}>
      <rect
        x={x} y={y} width={width} height={64} rx={14}
        className={admin ? 'fill-background stroke-brand' : 'fill-background stroke-border'}
        strokeWidth={admin ? 1.6 : 1.2}
      />
      <Icon name={icon} x={x + 13} y={y + 13} />
      <text x={x + 62} y={y + 28} className="fill-foreground text-[13px] font-semibold">{who}</text>
      <text x={x + 62} y={y + 47} className="fill-muted-foreground text-[12px]">{where}</text>
      {synced && (
        <g className="topology-synced" transform={`translate(${x + width - 24} ${y + 9})`}>
          <circle cx={7} cy={7} r={7} className="fill-brand" />
          <path d="M4 7.2l2.1 2.1L10.2 5" className="fill-none stroke-brand-foreground" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </g>
  );
}

/** Which hub features each person's line and card belong to. */
const MEMBER = 'collaborate everywhere';
const ADMIN = 'collaborate govern assets';

export function Topology({ locale }: { locale: Locale }) {
  const messages = locale === 'zh-CN' ? zhCN : en;
  const t = createTranslator({ locale, messages, namespace: 'home.topology' });
  // The hub's features are the page's own sections, named as the header names them.
  const nav = createTranslator({ locale, messages, namespace: 'home.nav' });
  const people = [
    { y: 52, to: 156, icon: 'laptop', key: 'desktop' },
    { y: 140, to: 200, icon: 'terminal', key: 'terminal', calls: true },
    { y: 228, to: 244, icon: 'phone', key: 'phone' },
    { y: 316, to: 288, icon: 'console', key: 'admin', admin: true },
  ] as const;
  const features = ['everywhere', 'collaborate', 'govern', 'assets'] as const;
  const hubRight = HUB.x + HUB.width;
  const hubCentre = HUB.x + HUB.width / 2;
  const edge = (p: (typeof people)[number]) => curve(LEFT + 194, p.y + 32, HUB.x - 2, p.to);
  const toModels = curve(hubRight + 2, 200, RIGHT - 2, 170);
  const toCloud = curve(hubRight + 2, 286, RIGHT - 2, CLOUD_Y + 32);
  return (
    <svg viewBox={`0 12 ${WIDTH} 408`} role="img" aria-label={t('label')} className="topology block h-auto w-full max-w-full text-foreground">
      <defs>
        <marker id="topology-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="fill-foreground" />
        </marker>
      </defs>

      {/* People to the hub: both ways for members (config down, calls up), into it for the admin. */}
      <g className="fill-none stroke-foreground" strokeWidth={1.4}>
        {people.map((p) => (
          <path
            key={p.key}
            data-f={'admin' in p ? ADMIN : MEMBER}
            d={edge(p)}
            markerEnd="url(#topology-arrow)"
            markerStart={'admin' in p ? undefined : 'url(#topology-arrow)'}
          />
        ))}
      </g>

      <rect x={HUB.x} y={HUB.y} width={HUB.width} height={HUB.height} rx={18} className="fill-brand" />
      <text x={hubCentre} y={HUB.y + 36} textAnchor="middle" className="fill-brand-foreground text-[15.5px] font-bold">DSH Teamwork</text>
      <line x1={HUB.x + 24} x2={hubRight - 24} y1={HUB.y + 54} y2={HUB.y + 54} className="stroke-brand-foreground/25" />
      {features.map((feature, i) => (
        <g key={feature} data-row={feature} transform={`translate(${HUB.x + 10} ${HUB.y + 66 + i * 48})`}>
          <rect width={HUB.width - 20} height={44} rx={9} className="topology-row fill-brand-foreground" />
          <g transform="translate(10 7)">
            <circle cx={9} cy={9} r={9} className="fill-brand-foreground/15" />
            <path d="M5 9.2l2.8 2.8L13 6.6" className="fill-none stroke-brand-foreground" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <text x={36} y={19} className="fill-brand-foreground text-[13px] font-semibold">{nav(feature)}</text>
          <text x={36} y={35} className="fill-brand-foreground/70 text-[10.5px]">{t(`features.${feature}`)}</text>
        </g>
      ))}

      {/* Model calls and cloud workspace access take separate paths from the hub. */}
      <path data-f="govern" d={toModels} className="fill-none stroke-foreground" strokeWidth={1.6} markerEnd="url(#topology-arrow)" />
      <path data-f="everywhere" d={toCloud} className="fill-none stroke-foreground" strokeWidth={1.4} markerEnd="url(#topology-arrow)" markerStart="url(#topology-arrow)" />

      {/* The story's pulses, in amber over the lines: publish, sync to every member, a member's call out to a model. */}
      <g className="fill-none stroke-signal" strokeWidth={3.5} strokeLinecap="round" aria-hidden="true">
        {people.map((p) =>
          'admin' in p ? (
            <path key={p.key} d={edge(p)} pathLength={100} className="topology-pulse topology-publish" />
          ) : (
            <path key={p.key} d={edge(p)} pathLength={100} className="topology-pulse topology-sync" />
          ),
        )}
        {people.map((p) => 'calls' in p && <path key={p.key} d={edge(p)} pathLength={100} className="topology-pulse topology-call" />)}
        <path d={toModels} pathLength={100} className="topology-pulse topology-model" />
      </g>

      <g data-f="govern">
        <rect x={RIGHT} y={UPSTREAM.y} width={RIGHT_WIDTH} height={UPSTREAM.height} rx={14} className="fill-muted stroke-border" strokeWidth={1.2} />
        <text x={RIGHT + 14} y={UPSTREAM.y + 26} className="fill-foreground text-[13px] font-semibold">{t('providers.title')}</text>
        <text x={RIGHT + 14} y={UPSTREAM.y + 43} className="fill-muted-foreground text-[11px]">{t('providers.body')}</text>
        {[...PROVIDERS, 'custom' as const].map((id, i) => {
          const x = RIGHT + 14;
          const y = UPSTREAM.y + 60 + i * ROW;
          return (
            <g key={id}>
              {id === 'custom' ? (
                <>
                  <rect x={x + 0.5} y={y + 0.5} width={17} height={17} rx={5} className="fill-none stroke-muted-foreground" strokeDasharray="3 2" />
                  <path d={`M${x + 9} ${y + 5}v8M${x + 5} ${y + 9}h8`} className="fill-none stroke-foreground" strokeWidth={1.5} strokeLinecap="round" />
                </>
              ) : (
                <>
                  <rect x={x - 1} y={y - 1} width={20} height={20} rx={5} className="fill-mark-plate" />
                  <MarkSvg mark={id} x={x + 2} y={y + 2} width={14} height={14} />
                </>
              )}
              <text x={x + 28} y={y + 13.5} className="fill-foreground text-[12px]">{t(`providers.${id}`)}</text>
            </g>
          );
        })}
      </g>
      <Node x={RIGHT} y={CLOUD_Y} width={RIGHT_WIDTH} icon="cloud" who={t('cloud.title')} where={t('cloud.status')} f="everywhere" />

      {people.map((p) => (
        <Node
          key={p.key} x={LEFT} y={p.y} icon={p.icon} who={t(`people.${p.key}.who`)} where={t(`people.${p.key}.where`)}
          admin={'admin' in p} synced={!('admin' in p)} f={'admin' in p ? ADMIN : MEMBER}
        />
      ))}
    </svg>
  );
}
