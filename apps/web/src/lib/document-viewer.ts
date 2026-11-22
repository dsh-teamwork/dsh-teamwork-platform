/**
 * The script of the sandboxed preview document (scripts/document-viewer.mjs builds it): it mounts the PDF or the
 * workbook viewer over the bytes it is given. The App embeds them in the page, as base64 in a JSON element; the
 * console posts them to its iframe, again for each file it opens. Nothing here can reach the console or the network:
 * the document has no origin of its own and a CSP that allows no requests.
 */
import { mountPdfViewer, type PdfLabels } from './pdf-viewer';
import { mountWorkbookViewer, type WorkbookLabels } from './workbook-viewer';

export type DocumentPayload =
  | { workbook: false; data: Uint8Array | string; labels: PdfLabels }
  | { workbook: true; data: Uint8Array | string; labels: WorkbookLabels };

const viewer = document.getElementById('viewer')!;
let dispose: (() => void) | undefined;

function show(payload: DocumentPayload) {
  dispose?.();
  dispose = undefined;
  const bytes = typeof payload.data === 'string' ? Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0)) : payload.data;
  try {
    dispose = payload.workbook ? mountWorkbookViewer(viewer, bytes, payload.labels) : mountPdfViewer(viewer, bytes, payload.labels);
  } catch {
    viewer.textContent = payload.labels.failed;
  }
}

function start() {
  const embedded = document.getElementById('dsh-document');
  if (embedded?.textContent) return show(JSON.parse(embedded.textContent) as DocumentPayload);
  addEventListener('message', (event: MessageEvent<DocumentPayload>) => {
    if (event.source === parent && event.data && typeof event.data === 'object') show(event.data);
  });
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true });
else start();
