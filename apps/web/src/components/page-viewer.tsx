/**
 * One page an agent published (docs/tech/pages.md): its title, sharing and versions, and the chosen version itself in
 * a frame from its view address, sandboxed as the server's own headers sandbox it. The address lasts an hour, so it
 * is minted again before it ends. Used beside a conversation and on Pages.
 */

import { Copy, ExternalLink, FileCode2, FileText, Image, Lock, Share2, Trash2, Users, UsersRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import { ShareDialog } from '@/components/page-share';
import { Button } from '@/components/ui/button';
import { api, ApiError, type Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type Detail = Schemas['PageDetail'];
type View = Schemas['PageView'];

/** Each kind of page's icon. */
export const KIND_ICON = { html: FileCode2, markdown: FileText, svg: Image } as const;

/** A person as a page names them: their name, else their email. */
export function personName(p: Schemas['PagePerson']) {
  return p.name || p.email || p.id;
}

export function SharingBadge({ sharing }: { sharing: Detail['sharing'] }) {
  const t = useTranslations('team.pages');
  const Icon = sharing === 'private' ? Lock : sharing === 'members' ? Users : UsersRound;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
      <Icon className="size-3" aria-hidden />
      {t(`sharing.${sharing}`)}
    </span>
  );
}

/** Renews a view address this long before it expires. */
const RENEW_BEFORE = 5 * 60_000;

export function PageViewer({ teamId, pageId, version, versions = false, onClose, onChanged }: {
  teamId: string;
  pageId: string;
  /** The version to open first; the newest when unset. */
  version?: number;
  /** Whether to list the versions below the page. */
  versions?: boolean;
  onClose?: () => void;
  /** Called after a change a list would show: sharing, a restore, a deletion. */
  onChanged?: (deleted: boolean) => void;
}) {
  const t = useTranslations('team.pages');
  const format = useFormatter();
  const base = `teams/${encodeURIComponent(teamId)}/pages/${encodeURIComponent(pageId)}`;
  const { data: page, error, reload } = useApi<Detail>(base);
  const [sharing, setSharing] = useState(false);
  const [acting, setActing] = useState(false);
  const [chosen, setChosen] = useState<number | undefined>(version);
  const [view, setView] = useState<{ n: number; data: View } | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = chosen ?? page?.currentVersion;

  const reads = page ? page.access !== 'admin' || page.versions.length > 0 : false;
  useEffect(() => {
    if (!shown || !reads) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const mint = async () => {
      try {
        const data = await api<View>(`${base}/versions/${shown}/view`, { method: 'POST' });
        if (!live) return;
        setView({ n: shown, data });
        setFailed(false);
        timer = setTimeout(() => void mint(), Math.max(60_000, Date.parse(data.expiresAt) - Date.now() - RENEW_BEFORE));
      } catch {
        if (live) setFailed(true);
      }
    };
    void mint();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [base, shown, reads]);

  async function act(run: () => Promise<unknown>, deleted = false) {
    setActing(true);
    try {
      await run();
      if (!deleted) await reload();
      onChanged?.(deleted);
    } catch {
      toast.error(t('actionFailed'));
    } finally {
      setActing(false);
    }
  }

  if (error) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        {onClose && <CloseButton onClose={onClose} />}
        <p role="alert" className="text-sm text-muted-foreground">{gone ? t('unavailable') : t('loadFailed')}</p>
      </div>
    );
  }
  if (!page) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;

  const link = `${window.location.origin}/teams/${teamId}/pages/${pageId}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{page.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <SharingBadge sharing={page.sharing} />
            <span>{t('owner', { name: personName(page.owner) })}</span>
            {page.sharing === 'members' && page.members.length > 0 && (
              <span>· {t('readers', { names: page.members.map(personName).join(', ') })}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {page.access !== 'reader' && (
            <Button size="sm" variant={page.access === 'owner' ? 'default' : 'outline'} disabled={acting} onClick={() => setSharing(true)}>
              <Share2 className="size-4" aria-hidden />
              {page.access === 'owner' ? t('share') : t('restrict')}
            </Button>
          )}
          {reads && <select
            aria-label={t('version')}
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={shown}
            onChange={(e) => setChosen(Number(e.target.value))}
          >
            {page.versions.map((v) => (
              <option key={v.number} value={v.number}>
                {v.number === page.currentVersion ? t('latest', { n: v.number }) : t('versionN', { n: v.number })}
              </option>
            ))}
          </select>}
          {reads && (
            <Button variant="outline" size="sm" aria-label={t('openTab')} title={t('openTab')} disabled={!view} onClick={() => view && window.open(view.data.url, '_blank', 'noopener,noreferrer')}>
              <ExternalLink className="size-4" aria-hidden />
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            aria-label={t('copyLink')}
            title={t('copyLink')}
            onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success(t('copied')))}
          >
            <Copy className="size-4" aria-hidden />
          </Button>
          {onClose && <CloseButton onClose={onClose} />}
        </div>
      </header>
      {!reads ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t('governOnly')}</p>
      ) : failed ? (
        <p role="alert" className="text-sm text-destructive">{t('loadFailed')}</p>
      ) : view && view.n === shown ? (
        <iframe
          key={view.data.url}
          title={page.title}
          src={view.data.url}
          sandbox="allow-scripts allow-popups allow-forms allow-modals"
          referrerPolicy="no-referrer"
          className="min-h-[60vh] w-full flex-1 rounded-lg border bg-white"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      )}
      {versions && reads && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('versions')}</h3>
          <ul className="divide-y rounded-lg border text-sm">
            {page.versions.map((v) => (
              <li key={v.number}>
                <button type="button" onClick={() => setChosen(v.number)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50" aria-current={v.number === shown}>
                  <span className="w-8 font-medium">v{v.number}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{personName(v.author)} · {format.dateTime(new Date(v.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[v.teamDsh ? t('fromTeamDsh') : v.computer, v.note].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {v.number === shown && <span className="text-xs text-muted-foreground">{t('showing')}</span>}
                </button>
                {page.access === 'owner' && v.number !== page.currentVersion && (
                  <div className="flex justify-end px-3 pb-2">
                    <Button size="sm" variant="ghost" disabled={acting} onClick={() => void act(() => api(`${base}/versions/${v.number}/restore`, { method: 'POST' }).then(() => setChosen(undefined)))}>
                      {t('restore', { n: v.number })}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {versions && page.access !== 'reader' && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={acting}
            onClick={() => window.confirm(t('deleteConfirm', { title: page.title })) && void act(() => api(base, { method: 'DELETE' }), true)}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('delete')}
          </Button>
        </div>
      )}
      {sharing && <ShareDialog teamId={teamId} page={page} open={sharing} onOpenChange={setSharing} onSaved={() => void reload().then(() => onChanged?.(false))} />}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const t = useTranslations('team.pages');
  return (
    <Button variant="ghost" size="sm" aria-label={t('close')} title={t('close')} onClick={onClose}>
      <X className="size-4" aria-hidden />
    </Button>
  );
}
