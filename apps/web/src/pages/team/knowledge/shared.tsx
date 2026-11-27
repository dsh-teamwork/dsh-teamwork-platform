/**
 * What the knowledge pages share: how a person is named, the menu of actions
 * beside a space, a folder or a document, and the one dialog that asks for a
 * name (a new space, folder or document, or a rename).
 */

import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Schemas } from '@/lib/api';
import { FORMATTING_NOTE } from '@dsh-teamwork/shared/knowledge-format';
import { cn } from '@/lib/utils';

/** A person as knowledge names them: their name, else their email. */
export function personName(p: Schemas['KnowledgePerson']) {
  return p.name || p.email || p.id;
}

/** A version's or proposal's note in the reader's language: the editor's formatting version is worded, every other note is the author's. */
export function useNote() {
  const t = useTranslations('team.knowledge');
  return (note: string) => (note === FORMATTING_NOTE ? t('formattingNote') : note);
}

export const menuItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent';

/** A "more" button opening a small menu of actions; nothing at all when there are none. */
export function ActionMenu({ label, items, className }: { label: string; items: { label: string; icon: ReactNode; onSelect: () => void; destructive?: boolean }[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        title={label}
        className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', className)}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-lg border bg-card p-1 text-card-foreground shadow-lg">
          {items.map((item) => (
            <DropdownMenu.Item key={item.label} onSelect={item.onSelect} className={cn(menuItem, item.destructive && 'text-destructive')}>
              {item.icon}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Asks for one name and submits it; the dialog stays open, with the failure
 * worded under the field, until `submit` succeeds.
 */
export function NameDialog({ title, description, label, initial = '', max, action, submit, onClose, children }: {
  title: string;
  description?: string;
  label: string;
  initial?: string;
  max: number;
  action: string;
  submit: (name: string) => Promise<unknown>;
  onClose: () => void;
  /** More of the form, under the name. */
  children?: ReactNode;
}) {
  const t = useTranslations('team.knowledge');
  const word = useTeamError();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const trimmed = name.trim();
  const invalid = /[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..';

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      await submit(trimmed);
      onClose();
    } catch (error) {
      setFailed(word(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void send(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Field id="knowledge-name" label={label} error={invalid ? t('nameSlash') : failed} hint={t('nameHint', { max })}>
            <Input id="knowledge-name" value={name} maxLength={max} autoFocus onChange={(e) => setName(e.target.value)} />
          </Field>
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || !trimmed || invalid || trimmed === initial}>{action}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
