import html from 'virtual:document-viewer';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';

import type { DocumentPayload } from '@/lib/document-viewer';
import { readTheme, subscribeTheme } from '@/lib/theme';

/**
 * A session's PDF or workbook, drawn by the preview document (scripts/document-viewer.mjs) in an iframe sandboxed
 * without same-origin: what an agent wrote runs with no access to the console's session, storage or network.
 */
export default function SessionDocumentPreview({ data, workbook }: { data: Uint8Array; workbook: boolean }) {
  const t = useTranslations('team.dsh.browse');
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  // The frame cannot see the console's theme, so it is told; a change draws the document again in the new one.
  const scheme = useSyncExternalStore(subscribeTheme, readTheme);
  useEffect(() => {
    if (!loaded) return;
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
    const theme = { scheme, ground: token('muted'), surface: token('background'), ink: token('foreground'), line: token('border') };
    const payload: DocumentPayload = workbook
      ? { workbook, data: data.slice(), labels: { loading: t('workbook.loading'), failed: t('workbook.failed'), truncated: t('workbook.truncated'), empty: t('workbook.empty') } }
      : { workbook, data: data.slice(), theme, labels: { zoomIn: t('pdf.zoomIn'), zoomOut: t('pdf.zoomOut'), loading: t('pdf.loading'), failed: t('pdf.failed') } };
    // The frame has no origin to name; only this frame is addressed, and the bytes are moved, not copied.
    frame.current?.contentWindow?.postMessage(payload, '*', [(payload.data as Uint8Array).buffer]);
  }, [loaded, data, workbook, scheme, t]);
  return (
    <iframe ref={frame} title={t(workbook ? 'workbook.title' : 'pdf.title')} srcDoc={html} sandbox="allow-scripts"
      onLoad={() => setLoaded(true)} className="min-h-0 w-full flex-1 border-0" />
  );
}
