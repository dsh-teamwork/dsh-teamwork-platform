import { useEffect, useRef } from 'react';
import { useTranslations } from 'use-intl';

export default function SessionDocumentPreview({ data, workbook }: { data: Uint8Array; workbook: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useTranslations('team.dsh.browse');
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let mounted = true;
    let dispose: (() => void) | undefined;
    host.textContent = t(workbook ? 'workbook.loading' : 'pdf.loading');
    const open = async () => {
      if (workbook) {
        const { mountWorkbookViewer } = await import('@/lib/workbook-viewer');
        if (mounted) dispose = mountWorkbookViewer(host, data.slice(), {
          loading: t('workbook.loading'), failed: t('workbook.failed'),
          truncated: t('workbook.truncated'), empty: t('workbook.empty'),
        });
      } else {
        const { mountPdfViewer } = await import('@/lib/pdf-viewer');
        if (mounted) dispose = mountPdfViewer(host, data.slice(), {
          previous: t('pdf.previous'), next: t('pdf.next'), zoomIn: t('pdf.zoomIn'), zoomOut: t('pdf.zoomOut'),
          loading: t('pdf.loading'), failed: t('pdf.failed'),
        });
      }
    };
    void open().catch(() => {
      if (mounted) host.textContent = t(workbook ? 'workbook.failed' : 'pdf.failed');
    });
    return () => { mounted = false; dispose?.(); };
  }, [data, workbook, t]);
  return <div ref={ref} className="min-h-0 flex-1" />;
}
