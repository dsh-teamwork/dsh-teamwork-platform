/**
 * The edition's community in the footer of the console's pages outside a team
 * (`EditionCommunity`, lib/edition.ts; components/site-frame.tsx): a link to
 * it, or, where joining is done by scanning a code with a phone, a popover
 * holding that code and the link. The open edition
 * has none, and this draws nothing.
 */

import { Popover } from 'radix-ui';
import { useLocale } from 'use-intl';

import { editionCommunity, type EditionCommunity } from '@/lib/edition';
import { cn } from '@/lib/utils';

/** The code, its line and the link, as the popover and the home page's static menu (src/public/home.tsx) both show it. */
export function CommunityCard({ community }: { community: EditionCommunity & { qr: NonNullable<EditionCommunity['qr']> } }) {
  return (
    <div className="flex w-56 flex-col items-center gap-2 p-3 text-center text-sm">
      {/* The code stays black on white in either theme, so a phone reads it. */}
      <img src={community.qr.src} alt="" width={200} height={200} className="size-50 rounded-md bg-white" />
      <p className="text-muted-foreground">{community.qr.caption}</p>
      <a href={community.href} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4 hover:text-foreground">
        {community.label}
      </a>
    </div>
  );
}

/** A footer's link to the community, opening its code where it has one. */
export function CommunityLink({ className }: { className?: string }) {
  const locale = useLocale() === 'zh-CN' ? 'zh-CN' : 'en';
  const community = editionCommunity(locale);
  if (!community) return null;
  const { qr } = community;
  if (!qr) {
    return (
      <a href={community.href} target="_blank" rel="noreferrer" className={cn('hover:text-foreground', className)}>
        {community.label}
      </a>
    );
  }
  return (
    <Popover.Root>
      <Popover.Trigger type="button" className={cn('hover:text-foreground', className)}>
        {community.label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} collisionPadding={12} className="z-50 rounded-lg border bg-card text-card-foreground shadow-lg">
          <CommunityCard community={{ ...community, qr }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
