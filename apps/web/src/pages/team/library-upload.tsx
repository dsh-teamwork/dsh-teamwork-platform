/** Sharing a preset or plugin from a file: a preset exported as JSON, or a plugin's npm archive, inspected first. */

import { Package } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';

import { useMutation } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, uploadPackage, type Schemas, type TeamConfig } from '@/lib/api';
import { inspectPluginArchive, type PluginPreview } from '@/lib/plugin-archive';
import { cn } from '@/lib/utils';

type Proposal = Schemas['ConfigInput'];
type Reload = () => Promise<unknown>;

/** A file picked by click or dropped on the box. */
function DropZone({ accept, label, hint, pick, children }: { accept: string; label: string; hint: string; pick: (file: File) => void; children?: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) pick(file);
      }}
      className={cn('flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-8 text-center text-sm', over ? 'border-ring bg-accent' : 'hover:bg-accent')}
    >
      <Package className="size-5 text-muted-foreground" aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
      {children}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pick(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** Import a preset from a JSON file and publish it to the current team. */
export function PresetDialog({ teamId, target, reload, onClose }: { teamId: string; target?: Extract<TeamConfig, { kind: 'preset' }>; reload: Reload; onClose: () => void }) {
  const t = useTranslations('team.library.upload');
  const { pending, run } = useMutation(reload);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [invalid, setInvalid] = useState(false);
  const data = (proposal?.data ?? {}) as Record<string, unknown>;

  async function read(file: File) {
    try {
      if (file.size > 65536) throw Error('too large');
      const value = JSON.parse(await file.text()) as Proposal;
      if (value.kind !== 'preset' || typeof value.name !== 'string' || !value.data) throw Error('not a preset');
      setProposal(target ? { ...value, name: target.name } : value);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(target ? 'uploadVersion' : 'importPreset')}</DialogTitle>
          <DialogDescription>{t('publicationHint')}</DialogDescription>
          {target && <p className="text-sm font-medium">{target.name} · v{target.version}</p>}
        </DialogHeader>
        {!proposal ? (
          <DropZone accept=".json,application/json" label={t('dropPreset')} hint={t('presetLimit')} pick={(file) => void read(file)} />
        ) : (
          <div className="flex flex-col gap-3">
            <Label htmlFor="proposal-name">{t('resourceName')}</Label>
            <Input id="proposal-name" value={proposal.name} maxLength={120} onChange={(e) => setProposal({ ...proposal, name: e.target.value })} />
            {proposal.kind === 'preset' && (
              <>
                <Label htmlFor="proposal-prompt">{t('prompt')}</Label>
                <Textarea
                  id="proposal-prompt"
                  className="min-h-32 font-mono text-xs"
                  value={String(data.systemPrompt ?? '')}
                  onChange={(e) => setProposal({ ...proposal, data: { ...proposal.data, systemPrompt: e.target.value } as Proposal['data'] })}
                />
              </>
            )}
          </div>
        )}
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {t('invalidFile')}
          </p>
        )}
        <DialogFooter>
          {proposal && <Button variant="outline" disabled={pending} onClick={() => { setProposal(null); setInvalid(false); }}>{t('replaceFile')}</Button>}
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={pending || !proposal || !proposal.name.trim()}
            onClick={async () => {
              if (!proposal) return;
              const ok = await run(() => api(target ? `teams/${teamId}/configs/${target.id}` : `teams/${teamId}/configs`, { method: target ? 'PATCH' : 'POST', body: { ...proposal, memberAsset: true, ...(target ? { version: target.version } : {}) } }), t('published'));
              if (ok) onClose();
            }}
          >
            {t('publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Inspect, upload and publish a plugin package to the current team. */
export function PluginDialog({ teamId, configs, initialTarget, reload, onClose }: { teamId: string; configs: TeamConfig[]; initialTarget?: string; reload: Reload; onClose: () => void }) {
  const t = useTranslations('team.library.upload');
  const { pending, run } = useMutation(reload);
  const [plugin, setPlugin] = useState<{ file: File; preview: PluginPreview } | null>(null);
  const [target, setTarget] = useState(initialTarget ?? '');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const plugins = configs.filter((c) => c.kind === 'plugin');

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initialTarget ? t('uploadVersion') : t('uploadPlugin')}</DialogTitle>
          <DialogDescription>{t('publicationHint')}</DialogDescription>
        </DialogHeader>
        {!plugin ? (
          <DropZone
            accept=".tgz,.gz"
            label={t('dropPlugin')}
            hint={t('pluginLimit')}
            pick={async (file) => {
              try {
                setPlugin({ file, preview: await inspectPluginArchive(file) });
                setInvalid(false);
              } catch {
                setInvalid(true);
              }
            }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {plugin.preview.package} <span className="text-muted-foreground">@ {plugin.preview.version}</span>
              </p>
              <p className="mt-1 font-mono text-xs break-all text-muted-foreground">SHA-256 {plugin.preview.sha256}</p>
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground hover:text-foreground">{t('includedFiles', { count: plugin.preview.files.length })}</summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs">{plugin.preview.files.join('\n')}</pre>
              </details>
            </div>
            <Label htmlFor="plugin-target">{t('target')}</Label>
            <Select
              id="plugin-target"
              label={t('target')}
              value={target}
              options={[{ value: '', label: t('newPlugin') }, ...plugins.map((c) => ({ value: c.id, label: `${c.name} · v${c.version}` }))]}
              change={setTarget}
              className="w-full"
            />
            <Label htmlFor="plugin-note">{t('assetDescription')}</Label>
            <Textarea id="plugin-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {t('invalidArchive')}
          </p>
        )}
        <DialogFooter>
          {plugin && <Button variant="outline" disabled={pending} onClick={() => { setPlugin(null); setInvalid(false); }}>{t('replaceFile')}</Button>}
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={pending || !plugin}
            onClick={async () => {
              if (!plugin) return;
              const existing = plugins.find((c) => c.id === target);
              const ok = await run(async () => {
                const pkg = await uploadPackage<Schemas['PluginPackage']>(teamId, plugin.file);
                if (pkg.sha256 !== plugin.preview.sha256) throw Error('Package mismatch');
                const config = {
                  kind: 'plugin',
                  name: existing?.name ?? plugin.preview.package,
                  data: { package: pkg.package, version: pkg.version, packageId: pkg.id, sha256: pkg.sha256, description: note },
                };
                return api(existing ? `teams/${teamId}/configs/${existing.id}` : `teams/${teamId}/configs`, {
                  method: existing ? 'PATCH' : 'POST',
                  body: { ...config, memberAsset: true, ...(existing ? { version: existing.version } : {}) },
                });
              }, t('published'));
              if (ok) onClose();
            }}
          >
            {t('publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
