import sheetjs from 'xlsx/dist/xlsx.full.min.js?raw';

export interface WorkbookLabels {
  loading: string;
  failed: string;
  truncated: string;
  empty: string;
}

const workerProgram = String.raw`
let bytes;
self.onmessage = ({ data }) => {
  try {
    if (data.bytes) {
      bytes = data.bytes;
      const names = XLSX.read(bytes, { bookSheets: true }).SheetNames;
      self.postMessage({ names: names.slice(0, 50), truncated: names.length > 50 });
      return;
    }
    const workbook = XLSX.read(bytes, { sheets: [data.sheet], sheetRows: 501, cellFormula: false, cellHTML: false });
    const sheet = workbook.Sheets[data.sheet];
    if (!sheet?.["!ref"]) return self.postMessage({ cells: [], truncated: false });
    const full = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"]);
    const range = { s: full.s, e: { r: Math.min(full.e.r, full.s.r + 499), c: Math.min(full.e.c, full.s.c + 39) } };
    const cells = XLSX.utils.sheet_to_json(sheet, { header: 1, range, raw: false, defval: "", blankrows: true })
      .map(row => row.map(value => String(value ?? "").slice(0, 2048)));
    self.postMessage({ cells, truncated: range.e.r < full.e.r || range.e.c < full.e.c });
  } catch {
    self.postMessage({ failed: true });
  }
};
`;

export function mountWorkbookViewer(host: HTMLElement, bytes: Uint8Array, labels: WorkbookLabels): () => void {
  host.replaceChildren();
  host.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;background:#fff;color:#202124;font:14px system-ui';
  const tabs = document.createElement('div');
  tabs.style.cssText = 'display:flex;gap:.3rem;overflow:auto;padding:.4rem;flex-shrink:0';
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.style.padding = '.4rem';
  const content = document.createElement('div');
  content.style.cssText = 'overflow:auto;min-height:0;flex:1';
  host.append(tabs, status, content);
  status.textContent = labels.loading;

  const url = URL.createObjectURL(new Blob([sheetjs, '\n', workerProgram], { type: 'text/javascript' }));
  const worker = new Worker(url);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let clippedSheets = false;
  let current: HTMLButtonElement | undefined;
  function fail() {
    clearTimeout(timeout);
    worker.terminate();
    status.textContent = labels.failed;
  }
  function request(message: object, transfer: Transferable[] = []) {
    clearTimeout(timeout);
    status.textContent = labels.loading;
    timeout = setTimeout(fail, 15_000);
    worker.postMessage(message, transfer);
  }
  worker.onerror = fail;
  worker.onmessage = ({ data }: MessageEvent<{ names?: string[]; cells?: string[][]; truncated?: boolean; failed?: boolean }>) => {
    clearTimeout(timeout);
    if (data.failed) return fail();
    if (data.names) {
      clippedSheets = data.truncated === true;
      for (const name of data.names) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.style.cssText = 'white-space:nowrap;padding:.3rem;color:inherit;background:white;border:1px solid #c6c8cc;border-radius:.3rem';
        tab.textContent = name;
        tab.onclick = () => {
          current?.removeAttribute('aria-pressed');
          current = tab;
          tab.setAttribute('aria-pressed', 'true');
          for (const button of tabs.querySelectorAll('button')) button.disabled = true;
          request({ sheet: name });
        };
        tabs.append(tab);
      }
      if (tabs.firstElementChild instanceof HTMLButtonElement) tabs.firstElementChild.click();
      else status.textContent = labels.empty;
      return;
    }
    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse';
    const body = table.createTBody();
    for (const row of data.cells ?? []) {
      const tr = body.insertRow();
      for (const value of row) {
        const cell = tr.insertCell();
        cell.style.cssText = 'border:1px solid #dadce0;padding:.25rem .5rem;white-space:pre-wrap;min-width:4rem;max-width:20rem;overflow-wrap:anywhere;vertical-align:top';
        cell.textContent = value;
      }
    }
    content.replaceChildren(table);
    content.scrollTo(0, 0);
    status.textContent = data.truncated || clippedSheets ? labels.truncated : data.cells?.length ? '' : labels.empty;
    for (const button of tabs.querySelectorAll('button')) button.disabled = false;
  };
  request({ bytes }, [bytes.buffer]);
  return () => {
    clearTimeout(timeout);
    worker.terminate();
    URL.revokeObjectURL(url);
    host.replaceChildren();
  };
}
