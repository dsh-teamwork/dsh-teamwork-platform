import { getDocument, GlobalWorkerOptions, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw';

export interface PdfLabels {
  previous: string;
  next: string;
  zoomOut: string;
  zoomIn: string;
  failed: string;
  loading: string;
}

/** The same read-only canvas viewer runs in the browser and the App's isolated WebView. */
export function mountPdfViewer(host: HTMLElement, data: Uint8Array, labels: PdfLabels): () => void {
  host.replaceChildren();
  host.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;color:#202124;background:#e8eaed;font:14px system-ui';
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.4rem;padding:.4rem;background:#fff';
  const content = document.createElement('div');
  content.style.cssText = 'flex:1;min-height:0;overflow:auto;text-align:center;padding:.5rem';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:none;margin:0 auto;background:white';
  content.append(canvas);
  host.append(toolbar, content);

  let pageNumber = 1;
  let zoom = 1;
  let active = true;
  let generation = 0;
  let job: RenderTask | undefined;
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = getDocument({ data, useWasm: false });
  const button = (text: string, action: () => void) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = text;
    control.style.cssText = 'font:inherit;padding:.35rem;color:inherit;border:1px solid #c6c8cc;border-radius:.3rem;background:white';
    control.onclick = action;
    return control;
  };
  const previous = button(labels.previous, () => { pageNumber--; void draw(); });
  const next = button(labels.next, () => { pageNumber++; void draw(); });
  const out = button(labels.zoomOut, () => { zoom = Math.max(.5, zoom / 1.25); void draw(); });
  const into = button(labels.zoomIn, () => { zoom = Math.min(3, zoom * 1.25); void draw(); });
  toolbar.append(previous, next, status, out, into);
  status.textContent = labels.loading;
  previous.disabled = next.disabled = out.disabled = into.disabled = true;

  async function draw() {
    const id = ++generation;
    job?.cancel();
    try {
      const pdf = await loading.promise;
      if (!active || id !== generation) return;
      pageNumber = Math.min(pdf.numPages, Math.max(1, pageNumber));
      const page = await pdf.getPage(pageNumber);
      if (!active || id !== generation) return;
      const original = page.getViewport({ scale: 1 });
      const width = Math.max(1, content.clientWidth - 16);
      const scale = Math.min(1, width / original.width) * zoom;
      // Limit raster memory even for very large source pages.
      const density = Math.min(window.devicePixelRatio || 1, 2, 4096 / (Math.max(original.width, original.height) * scale));
      const viewport = page.getViewport({ scale: scale * density });
      const buffer = document.createElement('canvas');
      buffer.width = Math.max(1, Math.ceil(viewport.width));
      buffer.height = Math.max(1, Math.ceil(viewport.height));
      job = page.render({ canvas: buffer, viewport });
      await job.promise;
      if (!active || id !== generation) return;
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      canvas.style.cssText = 'display:block;margin:0 auto;background:white';
      canvas.style.width = Math.round(original.width * scale) + 'px';
      canvas.style.height = Math.round(original.height * scale) + 'px';
      canvas.getContext('2d')?.drawImage(buffer, 0, 0);
      previous.disabled = pageNumber <= 1;
      next.disabled = pageNumber >= pdf.numPages;
      out.disabled = zoom <= .5;
      into.disabled = zoom >= 3;
      status.textContent = pageNumber + ' / ' + pdf.numPages + ' · ' + Math.round(zoom * 100) + '%';
    } catch {
      if (active && id === generation) status.textContent = labels.failed;
    }
  }

  const resize = new ResizeObserver(() => { void draw(); });
  resize.observe(content);
  void draw();
  return () => {
    active = false;
    resize.disconnect();
    job?.cancel();
    void loading.destroy().catch(() => {}).finally(() => {
      URL.revokeObjectURL(workerUrl);
    });
    host.replaceChildren();
  };
}
