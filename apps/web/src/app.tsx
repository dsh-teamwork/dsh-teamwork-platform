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
import {
  type EditionCommunity,
  type EditionModels,
  type EditionSecurity,
  replacing,
  setEditionCommunity,
  setEditionModels,
  setEditionSecurity,
  setEditionTeamNotice,
  setEditionTeamPages,
  setEditionTeamsNotice,
  type EditionTeamNotice,
  type EditionTeamsNotice,
  type TeamPage,
} from '@/lib/edition';
import { currentLocale, type Locale } from '@/lib/locale';
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
const ArtifactsPage = lazy(() => import('@/pages/team/artifacts').then((m) => ({ default: m.ArtifactsPage })));
// Knowledge brings its editor, Milkdown, which no other page loads.
const KnowledgePage = lazy(() => import('@/pages/team/knowledge').then((m) => ({ default: m.KnowledgePage })));
const TeamMyUsagePage = lazy(() => import('@/pages/team/my-usage').then((m) => ({ default: m.TeamMyUsagePage })));
const TeamHomePage = lazy(() => import('@/pages/team/overview').then((m) => ({ default: m.TeamHomePage })));
const TeamOverviewPage = lazy(() => import('@/pages/team/overview').then((m) => ({ default: m.TeamOverviewPage })));
const TeamHistoryPage = lazy(() => import('@/pages/team/history').then((m) => ({ default: m.TeamHistoryPage })));
const TeamLibraryPage = lazy(() => import('@/pages/team/library').then((m) => ({ default: m.TeamLibraryPage })));
const AdminOnly = lazy(() => import('@/pages/team/layout').then((m) => ({ default: m.AdminOnly })));
const TeamIndex = lazy(() => import('@/pages/team/layout').then((m) => ({ default: m.TeamIndex })));
const TeamUsagePage = lazy(() => import('@/pages/team/usage').then((m) => ({ default: m.TeamUsagePage })));
const MyDshPage = lazy(() => import('@/pages/team/my-dsh').then((m) => ({ default: m.MyDshPage })));
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
  /** Models the edition supplies, offered from the team's models page header (`EditionModels`). */
  models?: EditionModels;
  /** Notices above the teams list and inside one team's console. */
  teamsNotice?: EditionTeamsNotice;
  teamNotice?: EditionTeamNotice;
  security?: EditionSecurity;
  /** Where its users talk with its makers, in each language: the footer of the console's pages outside a team links to it (`EditionCommunity`). */
  community?: (locale: Locale) => EditionCommunity;
}

export function mountWeb({ routes = [], teamPages = [], models, teamsNotice, teamNotice, security, community }: WebExtension = {}) {
  const locale = currentLocale();
  document.documentElement.lang = locale;
  void startAnalytics();
  watchSystemTheme();
  setEditionTeamPages(teamPages);
  setEditionModels(models);
  setEditionTeamsNotice(teamsNotice);
  setEditionTeamNotice(teamNotice);
  setEditionSecurity(security);
  setEditionCommunity(community);
  window.addEventListener('vite:preloadError', reloadOnStaleChunk);

  // Workspace, for everyone in the team; Team management, for its admin, who alone
  // reaches those pages and lands on its overview: a member is sent home (ADR 0043, 0049). An
  // edition's team page joins the group it names, replacing an open one at its path.
  const own = (admin: boolean) => teamPages.filter((page) => (page.group !== 'work') === admin).map(({ path, element }) => ({ path, element }));
  const work = replacing(
    [
      { index: true, element: <TeamIndex /> },
      { path: 'home', element: <TeamHomePage /> },
      { path: 'presets', element: <TeamLibraryPage /> },
      { path: 'my-usage', element: <TeamMyUsagePage /> },
      { path: 'my-dsh/:hostId/settings', element: <MyDshPage settings /> },
      { path: 'my-dsh/:hostId/tasks/:taskId?', element: <MyDshPage tasks /> },
      { path: 'my-dsh/:hostId?/:sessionId?', element: <MyDshPage /> },
      { path: 'artifacts/:artifactId?', element: <ArtifactsPage /> },
      { path: 'knowledge/proposals/:proposalId?', element: <KnowledgePage view="proposals" /> },
      { path: 'knowledge/mentions', element: <KnowledgePage view="mentions" /> },
      { path: 'knowledge/spaces/:spaceId', element: <KnowledgePage view="space" /> },
      { path: 'knowledge/table/:spaceId/:folderId?', element: <KnowledgePage view="table" /> },
      { path: 'knowledge/:documentId?', element: <KnowledgePage /> },
    ],
    own(false),
  );
  const manage = replacing(
    [
      { path: 'overview', element: <TeamOverviewPage /> },
      { path: 'models', element: <TeamModelsPage /> },
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
