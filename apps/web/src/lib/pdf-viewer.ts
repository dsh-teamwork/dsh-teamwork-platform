import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw';

export interface PdfLabels {
  zoomOut: string;
  zoomIn: string;
  /** The zoom menu's name, read out with its value. */
  zoom: string;
  fitWidth: string;
  failed: string;
  loading: string;
}

/**
 * The host's theme, as the colours its tokens resolve to: the sandboxed page cannot read the host's stylesheet, so
 * the host reads them for it (`--document-ground`, `--card`, `--foreground`, `--border` on the console).
 */
export interface PdfTheme {
  scheme: 'light' | 'dark';
  /** Around and between the pages. */
  ground: string;
  /** The zoom control. */
  surface: string;
  ink: string;
  line: string;
}

/** Until a host passes its own (the App): the light theme the viewer always had. */
const FALLBACK: PdfTheme = { scheme: 'light', ground: '#ebeef2', surface: '#fff', ink: '#202124', line: '#c6c8cc' };

/** DSH's document preview (`ui-sidebar-documentpreview` pdf body, `ui-primitives` zoom): gaps, steps and timings. */
const GAP = 12;
const STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const PRESETS = [0.25, 0.5, 1, 1.5, 2];
/** The control shows while the pointer is this near the bottom, and hides this long after it leaves. */
const REVEAL_BAND = 72;
const HIDE_AFTER = 420;
/** A pinch or Ctrl+wheel redraws the pages this long after it stops; until then they stretch. */
const SETTLE = 120;

/** pdf.js's text layer, flattened from its `pdf_viewer.css`: transparent text over the canvas, for selecting. */
const TEXT_LAYER_CSS = `
.textLayer{position:absolute;text-align:initial;inset:0;overflow:clip;opacity:1;line-height:1;letter-spacing:normal;word-spacing:normal;text-size-adjust:none;-webkit-text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;caret-color:CanvasText;z-index:0;color-scheme:only light;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}
.textLayer span,.textLayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;user-select:text;-webkit-user-select:text}
.textLayer > :not(.markedContent),.textLayer .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.textLayer .markedContent{display:contents}
.textLayer ::selection{background:rgb(0 100 255 / .25);color:transparent}
.textLayer br::selection{background:transparent}
.textLayer .endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;user-select:none;-webkit-user-select:none}
.textLayer.selecting .endOfContent{top:0}
.zoom button{font:inherit;color:inherit;background:transparent;border:0;border-radius:6px;cursor:pointer;height:24px;display:flex;align-items:center;justify-content:center}
.zoom button:hover:not(:disabled){background:var(--hover)}
.zoom button:disabled{opacity:.4;cursor:default}
.menu button{width:100%;justify-content:flex-start;padding:0 10px;height:28px;white-space:nowrap}
`;

/** One page's place in the column: sized before it is drawn, drawn only while near the view. */
interface Slot {
  box: HTMLDivElement;
  /** The page's size at scale 1: the first page's until this page is read. */
  width: number;
  height: number;
  near: boolean;
  /** The layout it was last drawn for; another layout draws it again. */
  drawn: number;
  job?: RenderTask;
  text?: HTMLDivElement;
}

/**
 * A read-only viewer, mounted only inside the sandboxed preview document (src/lib/document-viewer.ts), as DSH's own:
 * every page in one scrolling column, fitted to the width until zoomed, each drawn as it comes near the view and
 * dropped as it leaves, its text selectable; a zoom control floats at the bottom, shown as the pointer nears it.
 */
export function mountPdfViewer(host: HTMLElement, data: Uint8Array, labels: PdfLabels, theme: PdfTheme = FALLBACK): () => void {
  host.replaceChildren();
  host.style.cssText = `position:relative;display:flex;flex-direction:column;height:100%;min-height:0;color:${theme.ink};background:${theme.ground};font:12px system-ui;color-scheme:${theme.scheme}`;
  const style = document.createElement('style');
  style.textContent = TEXT_LAYER_CSS;
  const content = document.createElement('div');
  content.style.cssText = `flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:${GAP}px;padding:${GAP}px`;
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.7;pointer-events:none';
  status.textContent = labels.loading;

  // The zoom control: out, the value with its menu, in.
  const control = document.createElement('div');
  control.className = 'zoom';
  control.style.cssText = `--hover:color-mix(in srgb, ${theme.ink} 8%, transparent);position:absolute;left:50%;bottom:14px;display:flex;align-items:center;gap:2px;padding:4px 6px;border-radius:10px;background:${theme.surface};border:.5px solid ${theme.line};box-shadow:0 4px 16px rgb(0 0 0 / .14);transform:translate(-50%,8px);opacity:0;pointer-events:none;transition:opacity 160ms,transform 160ms`;
  const button = (text: string, label: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.style.cssText = 'width:24px;font-size:15px';
    b.onclick = action;
    return b;
  };
  const out = button('−', labels.zoomOut, () => stepZoom(-1));
  const into = button('+', labels.zoomIn, () => stepZoom(1));
  const value = document.createElement('button');
  value.type = 'button';
  value.setAttribute('aria-haspopup', 'menu');
  value.style.cssText = 'min-width:58px;padding:0 6px;font-variant-numeric:tabular-nums';
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.style.cssText = `position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);display:none;flex-direction:column;padding:4px;min-width:120px;border-radius:10px;background:${theme.surface};border:.5px solid ${theme.line};box-shadow:0 4px 16px rgb(0 0 0 / .14)`;
  const choices: [string, number | 'fit'][] = [[labels.fitWidth, 'fit'], ...PRESETS.map((p): [string, number] => [`${Math.round(p * 100)}%`, p])];
  for (const [text, choice] of choices) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.textContent = text;
    item.onclick = () => {
      closeMenu();
      if (choice === 'fit') setZoom('fit');
      else setZoom(choice);
    };
    menu.append(item);
  }
  const closeMenu = () => { menu.style.display = 'none'; value.setAttribute('aria-expanded', 'false'); };
  value.onclick = () => {
    const opening = menu.style.display === 'none';
    menu.style.display = opening ? 'flex' : 'none';
    value.setAttribute('aria-expanded', String(opening));
  };
  control.append(out, value, into, menu);
  host.append(style, content, status, control);

  // Shown while the pointer is near the bottom, hidden a moment after it leaves; always shown to a touch screen.
  let hideTimer = 0;
  const showControl = (shown: boolean) => {
    clearTimeout(hideTimer);
    const apply = () => {
      control.style.opacity = shown ? '1' : '0';
      control.style.transform = shown ? 'translate(-50%,0)' : 'translate(-50%,8px)';
      control.style.pointerEvents = shown ? 'auto' : 'none';
      if (!shown) closeMenu();
    };
    if (shown) apply();
    else hideTimer = window.setTimeout(apply, HIDE_AFTER);
  };
  const coarse = matchMedia('(pointer: coarse)').matches;
  const pointer = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const box = host.getBoundingClientRect();
    showControl(box.bottom - event.clientY <= REVEAL_BAND || control.contains(event.target as Node) || menu.style.display !== 'none');
  };
  const leave = () => { if (menu.style.display === 'none') showControl(false); };
  host.addEventListener('pointermove', pointer);
  host.addEventListener('pointerleave', leave);

  let active = true;
  let pdf: PDFDocumentProxy | undefined;
  let slots: Slot[] = [];
  /** `fit` follows the width; a number is the scale itself, 1 being the page's own size. */
  let zoom: number | 'fit' = 'fit';
  let scale = 1;
  let layout = 0;
  let width = 0;
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = getDocument({ data, useWasm: false });

  const fail = () => {
    if (!active) return;
    status.textContent = labels.failed;
    status.style.display = 'flex';
  };

  const fitScale = () => Math.max(1, width - 2 * GAP) / (slots[0]?.width ?? 1);

  function report() {
    const percent = Math.round(scale * 100);
    value.textContent = zoom === 'fit' ? labels.fitWidth : `${percent}%`;
    value.setAttribute('aria-label', `${labels.zoom}: ${zoom === 'fit' ? labels.fitWidth : `${percent}%`}`);
    out.disabled = scale <= MIN_ZOOM + 1e-6;
    into.disabled = scale >= MAX_ZOOM - 1e-6;
  }

  function size(slot: Slot) {
    slot.box.style.width = Math.round(slot.width * scale) + 'px';
    slot.box.style.height = Math.round(slot.height * scale) + 'px';
    slot.box.style.setProperty('--total-scale-factor', String(scale));
  }

  /**
   * Sizes every page for the scale in force. `anchor` is a point of the view (the pointer, or the centre) that stays
   * on the same spot of the document; `redraw` false leaves the old drawings stretched until the zoom settles.
   */
  function relayout(anchor?: { x: number; y: number }, redraw = true) {
    if (!slots.length) return;
    const before = scale;
    const point = anchor ?? { x: content.clientWidth / 2, y: content.clientHeight / 2 };
    const docX = content.scrollLeft + point.x;
    const docY = content.scrollTop + point.y;
    width = content.clientWidth;
    scale = zoom === 'fit' ? fitScale() : zoom;
    for (const slot of slots) size(slot);
    if (before !== scale && before > 0) {
      const ratio = scale / before;
      content.scrollLeft = docX * ratio - point.x;
      content.scrollTop = docY * ratio - point.y;
    }
    report();
    if (redraw) settle();
  }

  /** Every near page drawn again at the scale in force. */
  function settle() {
    layout++;
    for (const slot of slots) {
      slot.job?.cancel();
      if (slot.near) void draw(slot);
    }
  }

  function setZoom(next: number | 'fit', anchor?: { x: number; y: number }, redraw = true) {
    zoom = next === 'fit' ? 'fit' : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    relayout(anchor, redraw);
  }

  /** A step of 25%, to the next multiple of it, as DSH's buttons step. */
  function stepZoom(direction: 1 | -1) {
    const steps = scale / STEP;
    const next = direction > 0 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;
    setZoom(next * STEP);
  }

  async function draw(slot: Slot) {
    const id = layout;
    if (!pdf || slot.drawn === id) return;
    slot.drawn = id;
    try {
      const page = await pdf.getPage(slots.indexOf(slot) + 1);
      if (!active || id !== layout || !slot.near) return void (slot.drawn = 0);
      const original = page.getViewport({ scale: 1 });
      if (original.width !== slot.width || original.height !== slot.height) {
        slot.width = original.width;
        slot.height = original.height;
        size(slot);
      }
      // Limit raster memory even for very large source pages.
      const density = Math.min(window.devicePixelRatio || 1, 2, 4096 / (Math.max(original.width, original.height) * scale));
      const viewport = page.getViewport({ scale: scale * density });
      const buffer = document.createElement('canvas');
      buffer.width = Math.max(1, Math.ceil(viewport.width));
      buffer.height = Math.max(1, Math.ceil(viewport.height));
      buffer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      slot.job = page.render({ canvas: buffer, viewport });
      await slot.job.promise;
      if (!active || id !== layout || !slot.near) return void (slot.drawn = 0);
      // The new drawing replaces the old one only once it is complete, so a zoom never flashes a blank page.
      slot.box.querySelector('canvas')?.remove();
      slot.box.prepend(buffer);
      // The text is laid once per page; its size follows `--total-scale-factor`, so a zoom needs no new layer.
      if (!slot.text) {
        const layer = document.createElement('div');
        layer.className = 'textLayer';
        slot.text = layer;
        slot.box.append(layer);
        await new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: page.getViewport({ scale: 1 }) }).render().catch(() => {});
      }
    } catch (error) {
      slot.drawn = 0;
      if ((error as { name?: string })?.name !== 'RenderingCancelledException') fail();
    }
  }

  const near = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const slot = slots.find((candidate) => candidate.box === entry.target);
      if (!slot) continue;
      slot.near = entry.isIntersecting;
      if (slot.near) {
        void draw(slot);
      } else {
        slot.job?.cancel();
        slot.drawn = 0;
        slot.text = undefined;
        slot.box.replaceChildren();
      }
    }
  }, { root: content, rootMargin: '100% 0px' });

  // Ctrl+wheel and a trackpad's pinch zoom around the pointer; the pages redraw once it settles.
  let settleTimer = 0;
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const box = content.getBoundingClientRect();
    setZoom(scale * Math.exp(-event.deltaY * 0.01), { x: event.clientX - box.left, y: event.clientY - box.top }, false);
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settle, SETTLE);
  };
  content.addEventListener('wheel', wheel, { passive: false });
  // A hidden tab measures nothing: its layout waits for it to be shown again, so its place is kept.
  const resize = new ResizeObserver(() => { if (content.clientWidth > 0 && content.clientWidth !== width && zoom === 'fit') relayout(); });

  void (async () => {
    try {
      pdf = await loading.promise;
      if (!active) return;
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      if (!active) return;
      slots = Array.from({ length: pdf.numPages }, () => {
        const box = document.createElement('div');
        // `margin:auto` rather than centring the column: a page zoomed wider than the view still scrolls to its left edge.
        box.style.cssText = `position:relative;flex-shrink:0;margin:0 auto;background:white;box-shadow:0 0 0 .5px ${theme.line},0 2px 10px rgb(0 0 0 / .12)`;
        content.append(box);
        return { box, width: first.width, height: first.height, near: false, drawn: 0 };
      });
      status.style.display = 'none';
      relayout();
      if (coarse) showControl(true);
      for (const slot of slots) near.observe(slot.box);
      resize.observe(content);
    } catch {
      fail();
    }
  })();

  return () => {
    active = false;
    near.disconnect();
    resize.disconnect();
    clearTimeout(hideTimer);
    clearTimeout(settleTimer);
    for (const slot of slots) slot.job?.cancel();
    void loading.destroy().catch(() => {}).finally(() => {
      URL.revokeObjectURL(workerUrl);
    });
    host.replaceChildren();
  };
}
