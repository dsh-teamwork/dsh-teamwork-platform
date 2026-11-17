/**
 * Copies a text the page also shows, so a refused clipboard (an insecure
 * origin, say) leaves the reader the text to select themselves.
 */

import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useTranslations('common');
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success(t('copied'));
        } catch {
          toast.error(t('copyFailed'));
        }
      }}
    >
      <Copy />
      {label ?? t('copy')}
    </Button>
  );
}
