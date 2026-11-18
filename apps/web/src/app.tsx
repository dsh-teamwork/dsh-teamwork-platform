/**
 * The web app: the console's routes and the providers around them, rendered by
 * `mountWeb`. The open build calls it with nothing (src/main.tsx); an
 * edition's web app (premium/apps/web) calls it with the pages it adds, each
 * replacing an open one at the same path. Public pages are not routes here: an
 * edition adds or replaces them in its own src/public/render.tsx, and the
 * server serves them by file name (server/internal/web). The entry imports
 * the stylesheet: an edition's own one imports this app's and adds its sources.
 */

import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useRouteError, type RouteObject } from 'react-router';
import { Toaster } from 'sonner';
import { IntlProvider, useTranslations } from 'use-intl';

import { CardPage, Loading } from '@/components/page';
import { Button } from '@/components/ui/button';
import { startAnalytics } from '@/lib/analytics';
import { replacing, setEditionTeamPages, type TeamPage } from '@/lib/edition';
import { currentLocale } from '@/lib/locale';
import { RequireUser, SessionProvider } from '@/lib/session';
import { watchSystemTheme } from '@/lib/theme';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';

// Team administration loads only when opened, keeping sign-in and plugin
// confirmation independent of the model, usage and budget forms.
const AccountPage = lazy(() => import('@/pages/account').then((m) => ({ default: m.AccountPage })));
const PasswordPage = lazy(() => import('@/pages/password').then((m) => ({ default: m.PasswordPage })));
const PluginPage = lazy(() => import('@/pages/plugin').then((m) => ({ default: m.PluginPage })));
const SetupPage = lazy(() => import('@/pages/setup').then((m) => ({ default: m.SetupPage })));
const SignInPage = lazy(() => import('@/pages/sign-in').then((m) => ({ default: m.SignInPage })));
const TeamLayout = lazy(() => import('@/pages/team/layout').then((m) => ({ default: m.TeamLayout })));
const TeamMembersPage = lazy(() => import('@/pages/team/members').then((m) => ({ default: m.TeamMembersPage })));
const TeamModelsPage = lazy(() => import('@/pages/team/models').then((m) => ({ default: m.TeamModelsPage })));
const TeamOverviewPage = lazy(() => import('@/pages/team/overview').then((m) => ({ default: m.TeamOverviewPage })));
const TeamPluginsPage = lazy(() => import('@/pages/team/plugins').then((m) => ({ default: m.TeamPluginsPage })));
const TeamHistoryPage = lazy(() => import('@/pages/team/history').then((m) => ({ default: m.TeamHistoryPage })));
const TeamSharingPage = lazy(() => import('@/pages/team/sharing').then((m) => ({ default: m.TeamSharingPage })));
const TeamResourcesPage = lazy(() => import('@/pages/team/resources').then((m) => ({ default: m.TeamResourcesPage })));
const AdminOnly = lazy(() => import('@/pages/team/layout').then((m) => ({ default: m.AdminOnly })));
const TeamPresetsPage = lazy(() => import('@/pages/team/presets').then((m) => ({ default: m.TeamPresetsPage })));
const TeamUsagePage = lazy(() => import('@/pages/team/usage').then((m) => ({ default: m.TeamUsagePage })));
const MyDshPage = lazy(() => import('@/pages/team/my-dsh').then((m) => ({ default: m.MyDshPage })));
const TeamDshPage = lazy(() => import('@/pages/team/team-dsh').then((m) => ({ default: m.TeamDshPage })));
const TeamDshHostsPage = lazy(() => import('@/pages/team/team-dsh-hosts').then((m) => ({ default: m.TeamDshHostsPage })));
const TeamBudgetsPage = lazy(() => import('@/pages/team/budgets').then((m) => ({ default: m.TeamBudgetsPage })));
const TeamsPage = lazy(() => import('@/pages/teams').then((m) => ({ default: m.TeamsPage })));

const locale = currentLocale();
document.documentElement.lang = locale;
void startAnalytics();

// A sign-in return can target the separately embedded management console. Let
// the server load that document rather than treating it as an unknown page.
function FallbackPage() {
  const location = useLocation();
  const manage = location.pathname === '/manage' || location.pathname.startsWith('/manage/');
  useEffect(() => {
    if (manage) window.location.replace(`${location.pathname}${location.search}${location.hash}`);
  }, [manage, location]);
  return manage ? <Loading /> : <Navigate to="/teams" replace />;
}

// A page still running an earlier build asks for chunks the server no longer
// holds once a new one is deployed. Reload once to fetch the current build; a
// second failure within a minute is a real one, left to RouteError.
const reloadedAt = 'dsh-chunk-reload';
function reloadOnStaleChunk(event: Event) {
  try {
    if (Date.now() - (Number(sessionStorage.getItem(reloadedAt)) || 0) < 60_000) return;
    sessionStorage.setItem(reloadedAt, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
}

/** What a route shows when it throws, instead of React Router's developer page. */
function RouteError() {
  const error = useRouteError();
  const t = useTranslations('common.failed');
  useEffect(() => console.error(error), [error]);
  return (
    <CardPage title={t('title')} description={t('description')}>
      <Button className="w-full" onClick={() => window.location.reload()}>
        {t('reload')}
      </Button>
    </CardPage>
  );
}

export interface WebExtension {
  /** Pages beside the console's own; wrap one in RequireUser (@/lib/session) for a signed-in page. */
  routes?: RouteObject[];
  /** Pages inside a team's console, listed in its navigation. */
  teamPages?: TeamPage[];
}

export function mountWeb({ routes = [], teamPages = [] }: WebExtension = {}) {
  const locale = currentLocale();
  document.documentElement.lang = locale;
  void startAnalytics();
  watchSystemTheme();
  setEditionTeamPages(teamPages);
  window.addEventListener('vite:preloadError', reloadOnStaleChunk);

  // Workspace, for everyone in the team; Team assets and Members and spend, for its
  // admin, who alone reaches those pages: a member is sent home (ADR 0043). An
  // edition's team page joins the group it names, replacing an open one at its path.
  const own = (admin: boolean) => teamPages.filter((page) => (page.group !== 'work') === admin).map(({ path, element }) => ({ path, element }));
  const work = replacing(
    [
      { index: true, element: <TeamOverviewPage /> },
      { path: 'resources', element: <TeamResourcesPage /> },
      { path: 'submissions', element: <TeamSharingPage view="mine" /> },
      { path: 'my-dsh/:hostId?/:sessionId?', element: <MyDshPage /> },
      { path: 'team-dsh/:computerId?/:sessionId?', element: <TeamDshPage /> },
    ],
    own(false),
  );
  const manage = replacing(
    [
      { path: 'models', element: <TeamModelsPage /> },
      { path: 'presets', element: <TeamPresetsPage /> },
      { path: 'plugins', element: <TeamPluginsPage /> },
      { path: 'team-dsh-hosts', element: <TeamDshHostsPage /> },
      { path: 'sharing', element: <TeamSharingPage view="review" /> },
      { path: 'history', element: <TeamHistoryPage /> },
      { path: 'members', element: <TeamMembersPage /> },
      { path: 'usage', element: <TeamUsagePage /> },
      { path: 'budgets', element: <TeamBudgetsPage /> },
    ],
    own(true),
  );
  const team: RouteObject[] = [...work, { element: <AdminOnly />, children: manage }];
  const router = createBrowserRouter([
    {
      errorElement: <RouteError />,
      children: [
        ...replacing(
          [
            { path: '/', element: <Navigate to="/teams" replace /> },
            { path: '/sign-in', element: <SignInPage /> },
            { path: '/setup', element: <SetupPage /> },
            { path: '/password', element: <PasswordPage /> },
            { path: '/plugin', element: <PluginPage /> },
            {
              element: <RequireUser />,
              children: [
                { path: '/account', element: <AccountPage /> },
                { path: '/teams', element: <TeamsPage /> },
                { path: '/teams/:teamId', element: <TeamLayout />, children: team },
              ],
            },
          ],
          routes,
        ),
        { path: '*', element: <FallbackPage /> },
      ],
    },
  ]);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <IntlProvider locale={locale} messages={locale === 'zh-CN' ? zhCN : en} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
        <SessionProvider>
          <Suspense fallback={<Loading />}><RouterProvider router={router} /></Suspense>
          <Toaster richColors />
        </SessionProvider>
      </IntlProvider>
    </StrictMode>,
  );
}
