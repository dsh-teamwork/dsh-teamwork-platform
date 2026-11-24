/**
 * A session's right sidebar, laid out and used as DSH's own (`ui-sidebar-right`, `ui-dockkit` and `ui-layout` in
 * DeepSeek Harness): a column beside the conversation, which moves over for it, from the top of the window; 45% of
 * the room on its first opening, 300px at least, 70% at most and never leaving the conversation under 400px, resized
 * from its left edge; tabs in one or two panes, each strip 38px with the controls at its end; full screen on demand and
 * always below 768px. What it holds is `session-sidebar-state.ts`; what a tab shows is the caller's (`body`).
 */

import { Columns2, Maximize, Minimize, PanelRight, Plus, X } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import {
  createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'use-intl';

import { baseName, FileTypeIcon } from '@/components/file-type-icon';
import { KIND_ICON } from '@/components/artifact-viewer';
import { cn } from '@/lib/utils';
import {
  closeOtherTabs, closeTab, closeTabsToRight, emptySidebar, loadSidebar, MAX_PANES, moveTab, openTab, saveSidebar, selectTab, setFullscreen, setOpen, setRatio, splitPane,
  type Pane, type SidebarState, type Tab,
} from './session-sidebar-state';

/** DSH's widths (`ui-layout/src/client/columns.ts`). */
const MIN_WIDTH = 300;
const MAX_RATIO = 0.7;
const DEFAULT_RATIO = 0.45;
const CENTRE_MIN = 400;
/** Below this the column always fills the window. */
const NARROW = 768;
/** What half a pane needs: a chip and a little body (`ui-dockkit/src/engine/geometry.ts`). */
const PANE_ROOM = 148;

/** The width a person last dragged to: kept while the page lives, as DSH keeps it, for every session. */
let remembered: number | null = null;

/** Where the column goes and how much room the conversation's row has, from `DshColumns`. */
export const SidebarSlotContext = createContext<{ slot: HTMLElement | null; room: number }>({ slot: null, room: 0 });

/** The column's place beside the conversation: `DshColumns` renders it and measures the row around it. */
export function useSidebarSlot() {
  return useContext(SidebarSlotContext);
}

function useNarrow() {
  const query = `(max-width: ${NARROW - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const change = () => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [query]);
  return narrow;
}

export interface TabBodyProps {
  tab: Tab;
  pane: Pane;
  /** Changes each time the tab is asked to read its content again (its reload button, Mod+Alt+R). */
  reload: number;
  onReload: () => void;
}

type Change = (state: SidebarState) => SidebarState;

/** Whether a key event carries the platform's command key: ⌘ on a Mac, Ctrl elsewhere. */
const mod = (event: { metaKey: boolean; ctrlKey: boolean }) => (/Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey);

export function SessionSidebar({ state, change, body, canBrowse }: {
  state: SidebarState;
  change: (change: Change) => void;
  body: (props: TabBodyProps) => ReactNode;
  /** Whether the computer lets this session's files be read, which the start page offers. */
  canBrowse: boolean;
}) {
  const t = useTranslations('team.dsh.sidebar');
  const { slot, room } = useSidebarSlot();
  const narrow = useNarrow();
  const max = Math.min(room * MAX_RATIO, room - CENTRE_MIN);
  const fits = max >= MIN_WIDTH;
  const width = Math.round(Math.max(MIN_WIDTH, Math.min(remembered ?? room * DEFAULT_RATIO, max)));
  const [, redraw] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [reloads, setReloads] = useState<Record<string, number>>({});
  const fullscreen = state.fullscreen || narrow;
  const shown = state.open && (fullscreen || fits);

  // Without room beside the conversation the column folds away, unless it fills the window (DSH's `canShow`).
  useEffect(() => {
    if (state.open && !fullscreen && room > 0 && !fits) change((s) => setOpen(s, false));
  }, [state.open, fullscreen, room, fits, change]);

  const reload = useCallback((tabId: string) => setReloads((r) => ({ ...r, [tabId]: (r[tabId] ?? 0) + 1 })), []);
  const focused = state.panes.find((pane) => pane.id === state.focused) ?? state.panes[0]!;

  // DSH's web shortcuts: Mod+Shift+B toggles the column, Mod+\ splits it, Mod+Alt+Enter fills the window,
  // Mod+Alt+W closes the focused page and Mod+Alt+R reads it again.
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (!mod(event)) return;
      const key = event.key.toLowerCase();
      let handled = true;
      if (event.shiftKey && !event.altKey && key === 'b') change((s) => setOpen(s, !s.open));
      else if (!event.altKey && !event.shiftKey && key === '\\') change(splitPane);
      else if (event.altKey && key === 'enter' && state.open) change((s) => setFullscreen(s, !s.fullscreen));
      else if (event.altKey && (event.code === 'KeyW') && state.open && focused.active) change((s) => closeTab(s, focused.active));
      else if (event.altKey && (event.code === 'KeyR') && state.open && focused.active) reload(focused.active);
      else handled = false;
      if (handled) event.preventDefault();
    };
    addEventListener('keydown', keydown);
    return () => removeEventListener('keydown', keydown);
  }, [change, reload, state.open, focused.active]);

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = event.clientX;
    const from = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    let frame = 0;
    const move = (e: globalThis.PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        remembered = Math.max(MIN_WIDTH, Math.min(from + start - e.clientX, max));
        redraw((n) => n + 1);
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragging(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  if (!slot) return null;
  const paneWidth = (fullscreen ? (typeof innerWidth === 'number' ? innerWidth : width) : width) / state.panes.length;
  const roomToSplit = state.panes.length < MAX_PANES && paneWidth / 2 >= PANE_ROOM;
  const splitBlocked = state.panes.length >= MAX_PANES ? t('splitLimit') : !roomToSplit ? t('splitRoom') : null;

  return createPortal(
    <aside
      data-session-sidebar
      aria-label={t('label')}
      inert={!shown}
      style={{ width: shown && !fullscreen ? width : fullscreen && shown ? undefined : 0 } as CSSProperties}
      className={cn(
        'z-10 flex shrink-0 flex-col overflow-x-clip bg-background',
        fullscreen && shown
          ? 'fixed inset-0 z-40'
          : 'sticky top-0 h-dvh border-l-[0.5px] border-border transition-[width,visibility] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none',
        !shown && 'invisible overflow-hidden border-l-0',
        dragging && 'transition-none select-none',
      )}
    >
      {/* The content keeps its width while the column slides, so nothing reflows under the animation. */}
      <div className="flex min-h-0 flex-1 overflow-hidden" style={fullscreen ? undefined : { width }}>
        {state.panes.map((pane, index) => (
          <Fragment key={pane.id}>
            {index > 0 && <Divider state={state} change={change} />}
            <PaneView
              pane={pane}
              state={state}
              change={change}
              last={index === state.panes.length - 1}
              flex={state.panes.length === 1 ? 1 : index === 0 ? state.ratio : 1 - state.ratio}
              fullscreen={fullscreen}
              narrow={narrow}
              splitBlocked={splitBlocked}
              body={body}
              reloads={reloads}
              reload={reload}
              canBrowse={canBrowse}
            />
          </Fragment>
        ))}
      </div>
      {shown && !fullscreen && (
        <div role="separator" aria-orientation="vertical" aria-label={t('resize')} onPointerDown={resize}
          className="absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize" />
      )}
    </aside>,
    slot,
  );
}

/** The hairline between two panes, dragged to share the width between them (20% to 80%). */
function Divider({ state, change }: { state: SidebarState; change: (change: Change) => void }) {
  const t = useTranslations('team.dsh.sidebar');
  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const row = event.currentTarget.parentElement!.getBoundingClientRect();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => change((s) => setRatio(s, (e.clientX - row.left) / row.width));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  return (
    <div role="separator" aria-orientation="vertical" aria-label={t('resizePanes')} aria-valuenow={Math.round(state.ratio * 100)} onPointerDown={down}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize">
      <span className="absolute inset-y-0 left-1/2 w-[0.5px] bg-border" />
      <span className="absolute top-1/2 left-1/2 h-8 w-px -translate-1/2 rounded-full bg-muted-foreground opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100" />
    </div>
  );
}

/** What is being dragged: a tab, by its id, across every pane of the page. */
let draggedTab: string | null = null;

function PaneView({ pane, state, change, last, flex, fullscreen, narrow, splitBlocked, body, reloads, reload, canBrowse }: {
  pane: Pane;
  state: SidebarState;
  change: (change: Change) => void;
  last: boolean;
  flex: number;
  fullscreen: boolean;
  narrow: boolean;
  splitBlocked: string | null;
  body: (props: TabBodyProps) => ReactNode;
  reloads: Record<string, number>;
  reload: (tabId: string) => void;
  canBrowse: boolean;
}) {
  const t = useTranslations('team.dsh.sidebar');
  const strip = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<{ index: number; x: number } | null>(null);
  const [drop, setDrop] = useState<'left' | 'right' | 'here' | null>(null);
  const [dragOn, setDragOn] = useState(false);
  // Which ends of the strip hide chips, each marked by a fade.
  const [overflow, setOverflow] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((o) => (o.start === start && o.end === end ? o : { start, end }));
  }, []);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(measure, [measure, pane.tabs.length]);
  // Tabs this pane has shown stay mounted, hidden, so going back to one keeps its place.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([pane.active]));
  if (pane.active && !visited.has(pane.active)) setVisited(new Set([...visited, pane.active]));
  const active = pane.tabs.find((tab) => tab.id === pane.active);
  const hasStart = pane.tabs.some((tab) => tab.kind === 'start');

  // The active chip scrolls into view, smoothly, as in DSH.
  useLayoutEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(pane.active)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [pane.active]);

  // A drag anywhere on the page lights up every pane's drop targets until it ends.
  useEffect(() => {
    const start = () => setDragOn(draggedTab !== null);
    const end = () => { setDragOn(false); setCaret(null); setDrop(null); };
    addEventListener('dragstart', start);
    addEventListener('dragend', end);
    addEventListener('drop', end);
    return () => {
      removeEventListener('dragstart', start);
      removeEventListener('dragend', end);
      removeEventListener('drop', end);
    };
  }, []);

  const stripOver = (event: DragEvent) => {
    if (!draggedTab) return;
    event.preventDefault();
    const chips = [...strip.current!.querySelectorAll<HTMLElement>('[data-tab]')];
    const box = strip.current!.getBoundingClientRect();
    let index = chips.findIndex((chip) => {
      const r = chip.getBoundingClientRect();
      return event.clientX < r.left + r.width / 2;
    });
    if (index < 0) index = chips.length;
    const edge = index < chips.length ? chips[index]!.getBoundingClientRect().left - 3 : (chips.at(-1)?.getBoundingClientRect().right ?? box.left) + 1;
    setCaret({ index, x: edge - box.left + strip.current!.scrollLeft });
  };
  const stripDrop = (event: DragEvent) => {
    event.preventDefault();
    const tab = draggedTab;
    if (tab && caret) change((s) => moveTab(s, tab, { pane: pane.id, index: caret.index }));
    setCaret(null);
  };

  const source = draggedTab ? state.panes.find((p) => p.tabs.some((tab) => tab.id === draggedTab)) : undefined;
  const bodyOver = (event: DragEvent) => {
    if (!draggedTab) return;
    if (state.panes.length >= MAX_PANES) {
      if (source?.id === pane.id) return setDrop(null);
      event.preventDefault();
      return setDrop('here');
    }
    // One pane: a half of its body splits the column there, unless the tab is all the pane holds.
    if (source?.id === pane.id && pane.tabs.length === 1) return setDrop(null);
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setDrop(event.clientX < box.left + box.width / 2 ? 'left' : 'right');
  };
  const bodyDrop = (event: DragEvent) => {
    event.preventDefault();
    const tab = draggedTab;
    if (tab && drop) change((s) => moveTab(s, tab, drop === 'here' ? { pane: pane.id } : { pane: pane.id, side: drop }));
    setDrop(null);
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = pane.tabs.findIndex((tab) => tab.id === pane.active);
    const go = (to: number) => {
      const tab = pane.tabs[(to + pane.tabs.length) % pane.tabs.length];
      if (!tab) return;
      change((s) => selectTab(s, tab.id));
      strip.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tab.id)}"]`)?.focus();
    };
    if (event.key === 'ArrowRight') go(index + 1);
    else if (event.key === 'ArrowLeft') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(pane.tabs.length - 1);
    else return;
    event.preventDefault();
  };

  const flashing = state.flash && state.flash.tab === pane.active ? state.flash.at : null;
  return (
    <section
      aria-label={active ? tabTitle(active, t) : t('label')}
      onPointerDownCapture={() => { if (state.focused !== pane.id) change((s) => ({ ...s, focused: pane.id })); }}
      className="relative flex min-w-0 flex-col"
      style={{ flex: `${flex} 1 0` }}
    >
      <div className="flex h-[38px] shrink-0 items-end gap-1 pt-2.5 pr-1.5 pl-2.5">
        <div
          ref={strip}
          role="tablist"
          aria-label={t('tabs')}
          onKeyDown={keys}
          onDragOver={stripOver}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setCaret(null); }}
          onDrop={stripDrop}
          onScroll={measure}
          data-fade-start={overflow.start || undefined}
          data-fade-end={overflow.end || undefined}
          className="session-sidebar-strip relative flex h-7 min-w-0 flex-1 items-center overflow-x-auto"
        >
          {pane.tabs.map((tab, index) => {
            const selectedChip = tab.id === pane.active;
            const quiet = pane.tabs.length === 1 && tab.kind === 'start';
            return (
              <Fragment key={tab.id}>
                {index > 0 && (
                  <span aria-hidden className="flex h-7 w-2.5 shrink-0 items-center justify-center">
                    {!selectedChip && pane.tabs[index - 1]!.id !== pane.active && <span className="h-3.5 w-[0.5px] bg-border" />}
                  </span>
                )}
                <Chip
                  tab={tab}
                  selected={selectedChip}
                  quiet={quiet}
                  title={tabTitle(tab, t)}
                  canCloseRight={index < pane.tabs.length - 1}
                  onSelect={() => change((s) => selectTab(s, tab.id))}
                  onClose={() => change((s) => closeTab(s, tab.id))}
                  onCloseOthers={() => change((s) => closeOtherTabs(s, tab.id))}
                  onCloseRight={() => change((s) => closeTabsToRight(s, tab.id))}
                />
              </Fragment>
            );
          })}
          {caret && <span aria-hidden className="pointer-events-none absolute top-1 h-5 w-0.5 rounded-full bg-brand" style={{ left: caret.x }} />}
        </div>
        {!hasStart && (
          <IconButton label={t('newTab')} onClick={() => change((s) => openTab(s, { kind: 'start' }, { pane: pane.id }))}>
            <Plus className="size-3.5" aria-hidden />
          </IconButton>
        )}
        {!narrow && (
          <IconButton label={splitBlocked ?? t('split')} disabled={splitBlocked !== null} onClick={() => change(splitPane)}>
            <Columns2 className="size-[15px]" aria-hidden />
          </IconButton>
        )}
        {last && (
          <>
            <IconButton label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
              onClick={() => change((s) => (narrow ? setOpen(setFullscreen(s, false), false) : setFullscreen(s, !s.fullscreen)))}>
              {fullscreen ? <Minimize className="size-[15px]" aria-hidden /> : <Maximize className="size-[15px]" aria-hidden />}
            </IconButton>
            <IconButton label={t('collapse')} onClick={() => change((s) => setOpen(setFullscreen(s, false), false))}>
              <PanelRight className="size-[15px]" aria-hidden />
            </IconButton>
          </>
        )}
      </div>
      <div
        key={flashing ?? undefined}
        className={cn('relative flex min-h-0 flex-1 flex-col', flashing && 'session-sidebar-flash')}
      >
        {pane.tabs.filter((tab) => visited.has(tab.id)).map((tab) => (
          <div key={tab.id} role="tabpanel" aria-hidden={tab.id !== pane.active} className={cn('min-h-0 flex-1 flex-col', tab.id === pane.active ? 'flex' : 'hidden')}>
            {tab.kind === 'start'
              ? <StartPage canBrowse={canBrowse} onFiles={() => change((s) => openTab(s, { kind: 'files' }, { replace: true, pane: pane.id }))} />
              : body({ tab, pane, reload: reloads[tab.id] ?? 0, onReload: () => reload(tab.id) })}
          </div>
        ))}
        {dragOn && (
          // Above the body, so an iframe in it cannot swallow the drag.
          <div className="absolute inset-0 z-10" onDragOver={bodyOver} onDragLeave={() => setDrop(null)} onDrop={bodyDrop}>
            {drop && (
              <div className={cn(
                'pointer-events-none absolute inset-y-2 flex items-center justify-center rounded-lg border border-dashed border-brand bg-brand/5 text-xs text-brand',
                drop === 'here' ? 'inset-x-2' : drop === 'left' ? 'right-1/2 left-2' : 'right-2 left-1/2',
              )}>
                {drop === 'here' ? t('moveHere') : drop === 'left' ? t('splitLeft') : t('splitRight')}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function tabTitle(tab: Tab, t: ReturnType<typeof useTranslations<'team.dsh.sidebar'>>): string {
  switch (tab.kind) {
    case 'start': return t('start');
    case 'files': return t('files');
    case 'file': return baseName(tab.path) || tab.path;
    case 'artifact': return tab.artifact.title;
    case 'changes': return t('changesTitle', { turn: tab.turn });
  }
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === 'file') return <FileTypeIcon path={tab.path} size={16} />;
  if (tab.kind === 'files') return <FileTypeIcon kind="folder" size={16} />;
  if (tab.kind === 'changes') return <FileTypeIcon kind="code" size={16} />;
  if (tab.kind === 'artifact') {
    const Icon = KIND_ICON[tab.artifact.kind];
    return <Icon className="size-4 shrink-0" aria-hidden />;
  }
  return null;
}

/** One tab: 28px tall, 80 to 170px wide, its title fading out at the end, its close button over the title. */
function Chip({ tab, selected, quiet, title, canCloseRight, onSelect, onClose, onCloseOthers, onCloseRight }: {
  tab: Tab;
  selected: boolean;
  quiet: boolean;
  title: string;
  canCloseRight: boolean;
  onSelect: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
}) {
  const t = useTranslations('team.dsh.sidebar');
  const closable = !quiet;
  // Only a title wider than its chip fades at its end; a short one is drawn whole.
  const text = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = text.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [title]);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          data-tab={tab.id}
          role="tab"
          aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          title={tab.kind === 'file' ? tab.path : title}
          draggable={!quiet}
          onDragStart={(event) => {
            draggedTab = tab.id;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', title);
          }}
          onDragEnd={() => { draggedTab = null; }}
          onClick={onSelect}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); }
          }}
          onAuxClick={(event) => { if (event.button === 1 && closable) { event.preventDefault(); onClose(); } }}
          onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
          className={cn(
            'group/chip relative flex h-7 max-w-[170px] min-w-20 shrink-0 cursor-pointer items-center rounded-lg px-2.5 text-[13px] leading-[1.4] outline-none focus-visible:ring-2 focus-visible:ring-ring',
            // The close button sits over the end, out of the flow: the chip keeps room for it, so its width never moves.
            closable && 'pr-[26px]',
            quiet ? 'min-w-0 text-foreground' : selected ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-[5px] overflow-hidden whitespace-nowrap">
            <TabIcon tab={tab} />
            <span ref={text} className={cn('min-w-0 overflow-hidden', overflowing && 'session-sidebar-chip-title')}>{title}</span>
          </span>
          {closable && (
            <button
              type="button"
              aria-label={t('close')}
              title={`${t('close')} (${navigator.platform.includes('Mac') ? '⌘⌥W' : 'Ctrl+Alt+W'})`}
              tabIndex={-1}
              onClick={(event) => { event.stopPropagation(); onClose(); }}
              className={cn(
                'absolute top-1 right-1 flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
                selected ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover/chip:pointer-events-auto group-hover/chip:opacity-100 group-focus-within/chip:pointer-events-auto group-focus-within/chip:opacity-100',
              )}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </ContextMenu.Trigger>
      {closable && (
        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 min-w-44 rounded-lg border bg-card p-1 text-[12px] text-card-foreground shadow-lg">
            <MenuItem onSelect={onClose}>{t('close')}</MenuItem>
            <MenuItem onSelect={onCloseOthers}>{t('closeOthers')}</MenuItem>
            {canCloseRight && <MenuItem onSelect={onCloseRight}>{t('closeRight')}</MenuItem>}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      )}
    </ContextMenu.Root>
  );
}

function MenuItem({ onSelect, children }: { onSelect: () => void; children: ReactNode }) {
  return (
    <ContextMenu.Item onSelect={onSelect} className="cursor-pointer rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent">
      {children}
    </ContextMenu.Item>
  );
}

/** A 28px square control of the sidebar's chrome, its label as its tooltip. */
export function IconButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent',
        pressed && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** DSH's guide page: where a new tab starts, with what the sidebar can open. */
function StartPage({ canBrowse, onFiles }: { canBrowse: boolean; onFiles: () => void }) {
  const t = useTranslations('team.dsh.sidebar');
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{t('startTitle')}</h3>
        {canBrowse ? (
          <button type="button" onClick={onFiles}
            className="flex items-center gap-3 rounded-xl border-[0.5px] border-border bg-card px-3 py-3 text-start hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-border bg-background">
              <FileTypeIcon kind="folder" size={20} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t('files')}</span>
              <span className="block text-xs text-muted-foreground">{t('filesHint')}</span>
            </span>
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('filesUnavailable')}</p>
        )}
      </div>
    </div>
  );
}

/** The conversation header's button that brings the column back, shown only while it is folded away. */
export function SidebarOpenButton({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('team.dsh.sidebar');
  const shortcut = typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘⇧B' : 'Ctrl+Shift+B';
  return (
    <IconButton label={`${t('open')} (${shortcut})`} onClick={onOpen}>
      <PanelRight className="size-[15px]" aria-hidden />
    </IconButton>
  );
}

/** A session's sidebar, read from and written back to this browser under `scope` (none for a session not started). */
export function useSidebarState(scope: string | null) {
  const [held, setHeld] = useState(() => ({ scope, state: scope ? loadSidebar(scope) : emptySidebar() }));
  if (held.scope !== scope) setHeld({ scope, state: scope ? loadSidebar(scope) : emptySidebar() });
  const change = useCallback((apply: Change) => setHeld((h) => {
    const state = apply(h.state);
    if (state === h.state) return h;
    if (h.scope) saveSidebar(h.scope, state);
    return { scope: h.scope, state };
  }), []);
  return [held.state, change] as const;
}
