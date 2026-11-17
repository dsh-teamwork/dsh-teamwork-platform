import { createTranslator } from 'use-intl';

import type { Locale } from '@/lib/locale';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';

/*
 * The home page's first-screen diagram (docs/design.md, "The landing page's
 * first screen"): how a team uses DSH Teamwork, left to right. On the left,
 * the people and where each one works (DSH Desktop, a terminal, the phone, the
 * admin's web console); in the middle, the one place that governs and syncs;
 * on the right, the upstream model providers it forwards calls to (the
 * console's own catalogue, lib/provider-catalog.ts) and the cloud DSH that is
 * coming. Inline SVG drawn from the theme's tokens, so it follows light and
 * dark; the icons are lucide's, at their 24-unit size.
 */

const ICONS = {
  laptop: <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16" />,
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </>
  ),
  phone: (
    <>
      <rect width="14" height="20" x="5" y="2" rx="2" />
      <path d="M12 18h.01" />
    </>
  ),
  console: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
  cpu: (
    <>
      <rect width="16" height="16" x="4" y="4" rx="2" />
      <rect width="6" height="6" x="9" y="9" rx="1" />
      <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
    </>
  ),
};

/** The providers the console offers to connect (lib/provider-catalog.ts), as their marks. */
const PROVIDERS = ['deepseek', 'openai', 'qwen', 'moonshot', 'zhipu', 'doubao', 'minimax', 'siliconflow', 'openrouter', 'custom'] as const;
const MARKS: Record<(typeof PROVIDERS)[number], string> = {
  deepseek: 'DS', openai: 'OA', qwen: 'QW', moonshot: 'KM', zhipu: 'GL', doubao: 'DB', minimax: 'MM', siliconflow: 'SF', openrouter: 'OR', custom: '+',
};

/** A curve leaving one side horizontally and arriving at the other horizontally. */
const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const m = (x1 + x2) / 2;
  return `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
};

const LEFT = 16;
const HUB = [350, 498] as const;
const RIGHT = 596;

function Icon({ name, x, y }: { name: keyof typeof ICONS; x: number; y: number }) {
  return (
    <>
      <rect x={x} y={y} width={38} height={38} rx={10} className="fill-muted stroke-border" />
      <g transform={`translate(${x + 8} ${y + 8}) scale(0.92)`} className="fill-none stroke-foreground" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </g>
    </>
  );
}

function Node({ x, y, width = 192, icon, who, where, admin, waiting, coming }: {
  x: number; y: number; width?: number; icon: keyof typeof ICONS; who: string; where: string; admin?: boolean; waiting?: boolean; coming?: boolean;
}) {
  return (
    <g opacity={coming ? 0.6 : 1}>
      <rect
        x={x} y={y} width={width} height={64} rx={14}
        className={admin ? 'fill-background stroke-brand' : coming ? 'fill-none stroke-input' : 'fill-background stroke-border'}
        strokeWidth={admin ? 1.6 : 1.2} strokeDasharray={coming ? '5 5' : undefined}
      />
      <Icon name={icon} x={x + 13} y={y + 13} />
      {waiting && <circle cx={x + 48} cy={y + 16} r={4.5} className="fill-signal" />}
      <text x={x + 62} y={y + 28} className="fill-foreground text-[13px] font-semibold">{who}</text>
      <text x={x + 62} y={y + 47} className="fill-muted-foreground text-[12px]">{where}</text>
    </g>
  );
}

export function Topology({ locale }: { locale: Locale }) {
  const t = createTranslator({ locale, messages: locale === 'zh-CN' ? zhCN : en, namespace: 'home.topology' });
  const people = [
    { y: 52, to: 160, icon: 'laptop', key: 'desktop', label: 'sync', below: false },
    { y: 140, to: 205, icon: 'terminal', key: 'terminal', label: 'sync', below: false },
    { y: 228, to: 250, icon: 'phone', key: 'phone', label: 'approve', below: true, waiting: true },
    { y: 316, to: 300, icon: 'console', key: 'admin', label: 'govern', below: true, admin: true },
  ] as const;
  const chips = ['models', 'presets', 'review', 'budgets', 'members'] as const;
  return (
    <svg viewBox="0 0 820 420" role="img" aria-label={t('label')} className="block h-auto w-full max-w-full text-foreground">
      <defs>
        <marker id="topology-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="fill-foreground" />
        </marker>
      </defs>

      <g className="fill-muted-foreground font-mono text-[11px] tracking-wider">
        <text x={LEFT} y={30}>{t('columns.people')}</text>
        <text x={(HUB[0] + HUB[1]) / 2} y={30} textAnchor="middle">{t('columns.hub')}</text>
        <text x={RIGHT + 208} y={30} textAnchor="end">{t('columns.upstream')}</text>
      </g>

      {/* People to the hub: both ways for members (config down, calls up), into it for the admin. */}
      <g className="fill-none stroke-foreground" strokeWidth={1.4}>
        {people.map((p) => (
          <path
            key={p.key}
            d={curve(LEFT + 194, p.y + 32, HUB[0] - 2, p.to)}
            markerEnd="url(#topology-arrow)"
            markerStart={'admin' in p ? undefined : 'url(#topology-arrow)'}
          />
        ))}
      </g>
      <g className="fill-muted-foreground text-[11px]">
        {people.map((p) => (
          <text key={p.key} x={LEFT + 200} y={p.below ? p.y + 51 : p.y + 23}>{t(`edges.${p.label}`)}</text>
        ))}
      </g>

      <rect x={HUB[0]} y={48} width={HUB[1] - HUB[0]} height={352} rx={18} className="fill-brand" />
      <text x={424} y={84} textAnchor="middle" className="fill-brand-foreground text-[17px] font-bold">DSH Teamwork</text>
      <text x={424} y={103} textAnchor="middle" className="fill-brand-foreground/75 text-[11.5px]">{t('hub.tagline')}</text>
      {chips.map((chip, i) => (
        <g key={chip}>
          <rect x={368} y={128 + i * 34} width={112} height={26} rx={13} className="fill-none stroke-brand-foreground/45" />
          <text x={424} y={145 + i * 34} textAnchor="middle" className="fill-brand-foreground text-[11.5px]">{t(`hub.${chip}`)}</text>
        </g>
      ))}
      <text x={424} y={352} textAnchor="middle" className="fill-brand-foreground/75 text-[11.5px]">{t('hub.hosted')}</text>
      <text x={424} y={370} textAnchor="middle" className="fill-brand-foreground/75 text-[11.5px]">{t('hub.selfHosted')}</text>

      {/* The hub to the providers: calls go out, keys stay. */}
      <path d={curve(HUB[1] + 2, 190, RIGHT - 2, 150)} className="fill-none stroke-foreground" strokeWidth={1.6} markerEnd="url(#topology-arrow)" />
      <text x={506} y={214} className="fill-foreground text-[11px] font-semibold">{t('edges.forward')}</text>
      <text x={506} y={229} className="fill-foreground text-[11px] font-semibold">{t('edges.keys')}</text>
      <path d={curve(HUB[1] + 2, 330, RIGHT - 2, 354)} className="fill-none stroke-foreground" strokeWidth={1.4} strokeDasharray="5 5" opacity={0.5} markerStart="url(#topology-arrow)" markerEnd="url(#topology-arrow)" />
      <text x={506} y={322} className="fill-muted-foreground text-[11px]" opacity={0.7}>{t('edges.sync')}</text>

      <rect x={RIGHT} y={48} width={208} height={252} rx={14} className="fill-muted stroke-border" strokeWidth={1.2} />
      <Icon name="cpu" x={RIGHT + 13} y={61} />
      <text x={RIGHT + 62} y={76} className="fill-foreground text-[13px] font-semibold">{t('providers.title')}</text>
      <text x={RIGHT + 62} y={94} className="fill-muted-foreground text-[12px]">{t('providers.body')}</text>
      {PROVIDERS.map((id, i) => {
        const x = RIGHT + 14 + (i % 2) * 96;
        const y = 118 + Math.floor(i / 2) * 34;
        return (
          <g key={id}>
            <rect x={x} y={y} width={24} height={24} rx={6} className="fill-background stroke-border" />
            <text x={x + 12} y={y + 16} textAnchor="middle" className="fill-foreground font-mono text-[9.5px] font-semibold">{MARKS[id]}</text>
            <text x={x + 30} y={y + 16} className="fill-foreground text-[11px]">{t(`providers.${id}`)}</text>
          </g>
        );
      })}
      <Node x={RIGHT} y={322} width={208} icon="cloud" who={t('cloud.who')} where={t('cloud.where')} coming />

      {people.map((p) => (
        <Node key={p.key} x={LEFT} y={p.y} icon={p.icon} who={t(`people.${p.key}.who`)} where={t(`people.${p.key}.where`)} admin={'admin' in p} waiting={'waiting' in p} />
      ))}
    </svg>
  );
}
