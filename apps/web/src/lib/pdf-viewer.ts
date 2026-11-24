import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw';

export interface PdfLabels {
  zoomOut: string;
  zoomIn: string;
  failed: string;
  loading: string;
}

/**
 * The host's theme, as the colours its tokens resolve to: the sandboxed page cannot read the host's stylesheet, so
 * the host reads them for it (`--muted`, `--background`, `--foreground`, `--border` on the console).
 */
export interface PdfTheme {
  scheme: 'light' | 'dark';
  /** Around and between the pages. */
  ground: string;
  /** The toolbar. */
  surface: string;
  ink: string;
  line: string;
}

/** Until a host passes its own (the App): the light theme the viewer always had. */
const FALLBACK: PdfTheme = { scheme: 'light', ground: '#e8eaed', surface: '#fff', ink: '#202124', line: '#c6c8cc' };

const GAP = 12;

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
}

/**
 * A read-only viewer, mounted only inside the sandboxed preview document (src/lib/document-viewer.ts): every page in
 * one scrolling column, fitted to the width at 100%, each drawn as it comes near the view and dropped as it leaves.
 */
export function mountPdfViewer(host: HTMLElement, data: Uint8Array, labels: PdfLabels, theme: PdfTheme = FALLBACK): () => void {
    host.replaceChildren();
  host.style.cssText = `display:flex;flex-direction:column;height:100%;min-height:0;color:${theme.ink};background:${theme.ground};font:13px system-ui;color-scheme:${theme.scheme}`;
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `display:flex;align-items:center;justify-content:flex-end;gap:.25rem;padding:.3rem .5rem;background:${theme.surface};border-bottom:1px solid ${theme.line}`;
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.style.cssText = 'flex:1;font-variant-numeric:tabular-nums;opacity:.75';
  const content = document.createElement('div');
  content.style.cssText = `flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:${GAP}px;padding:${GAP}px`;
  host.append(toolbar, content);

  const button = (text: string, label: string, action: () => void) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = text;
    control.title = label;
    control.setAttribute('aria-label', label);
    control.style.cssText = `font:inherit;font-size:16px;line-height:1;width:1.9rem;height:1.9rem;color:inherit;border:1px solid ${theme.line};border-radius:.375rem;background:transparent;cursor:pointer`;
    control.onclick = action;
    return control;
  };
  const out = button('−', labels.zoomOut, () => setZoom(zoom / 1.25));
  const into = button('+', labels.zoomIn, () => setZoom(zoom * 1.25));
  toolbar.append(status, out, into);
  status.textContent = labels.loading;
  out.disabled = into.disabled = true;

  let active = true;
  let pdf: PDFDocumentProxy | undefined;
  let slots: Slot[] = [];
  let zoom = 1;
  let scale = 1;
  let layout = 0;
  let width = 0;
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = getDocument({ data, useWasm: false });

  const fail = () => { if (active) status.textContent = labels.failed; };

  /** Where the reader is: the page across the middle of the view, and how far down it. */
  function reading(): { index: number; within: number } {
    // At either end, that end's page: a short last page may never reach the middle.
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 1) return { index: slots.length - 1, within: 0 };
    if (content.scrollTop <= 0) return { index: 0, within: 0 };
    const middle = content.scrollTop + content.clientHeight / 2;
    for (let index = 0; index < slots.length; index++) {
      const box = slots[index].box;
      if (box.offsetTop + box.offsetHeight + GAP / 2 >= middle) {
        return { index, within: Math.max(0, (content.scrollTop - box.offsetTop) / Math.max(1, box.offsetHeight)) };
      }
    }
    return { index: Math.max(0, slots.length - 1), within: 0 };
  }

  function report() {
    if (!pdf || !active) return;
    status.textContent = `${reading().index + 1} / ${pdf.numPages} · ${Math.round(zoom * 100)}%`;
  }

  /** Sizes every page for the width and zoom in force, keeping the reader on the page they were reading. */
  function relayout() {
    if (!slots.length) return;
    const keep = width ? reading() : null;
    width = content.clientWidth;
    scale = (Math.max(1, width - 2 * GAP) / slots[0].width) * zoom;
    layout++;
    for (const slot of slots) {
      slot.job?.cancel();
      size(slot);
    }
    if (keep && keep.index + keep.within > 0) {
      const anchor = slots[keep.index].box;
      content.scrollTop = anchor.offsetTop + keep.within * anchor.offsetHeight;
    }
    for (const slot of slots) if (slot.near) void draw(slot);
    out.disabled = zoom <= .5;
    into.disabled = zoom >= 3;
    report();
  }

  function size(slot: Slot) {
    slot.box.style.width = Math.round(slot.width * scale) + 'px';
    slot.box.style.height = Math.round(slot.height * scale) + 'px';
  }

  function setZoom(next: number) {
    zoom = Math.min(3, Math.max(.5, next));
    relayout();
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
      buffer.style.cssText = 'display:block;width:100%;height:100%';
      slot.job = page.render({ canvas: buffer, viewport });
      await slot.job.promise;
      if (!active || id !== layout || !slot.near) return void (slot.drawn = 0);
      // The new drawing replaces the old one only once it is complete, so a zoom never flashes a blank page.
      slot.box.replaceChildren(buffer);
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
        slot.box.replaceChildren();
      }
    }
  }, { root: content, rootMargin: '100% 0px' });

  let frame = 0;
  const scrolled = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; report(); });
  };
  content.addEventListener('scroll', scrolled, { passive: true });
  const resize = new ResizeObserver(() => { if (content.clientWidth !== width) relayout(); });

  void (async () => {
    try {
      pdf = await loading.promise;
      if (!active) return;
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      if (!active) return;
      slots = Array.from({ length: pdf.numPages }, () => {
        const box = document.createElement('div');
        // A page is paper whatever the theme, as the document draws it.
        // `margin:auto` rather than centring the column: a page zoomed wider than the view still scrolls to its left edge.
        box.style.cssText = `flex-shrink:0;margin:0 auto;background:white;outline:1px solid ${theme.line};box-shadow:0 1px 3px rgb(0 0 0 / .2)`;
        content.append(box);
        return { box, width: first.width, height: first.height, near: false, drawn: 0 };
      });
      relayout();
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
    cancelAnimationFrame(frame);
    for (const slot of slots) slot.job?.cancel();
    void loading.destroy().catch(() => {}).finally(() => {
      URL.revokeObjectURL(workerUrl);
    });
    host.replaceChildren();
  };
}
