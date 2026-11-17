import './globals.css';

import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { IntlProvider } from 'use-intl';

import { startAnalytics } from '@/lib/analytics';
import { Loading } from '@/components/page';
import { currentLocale } from '@/lib/locale';
import { watchSystemTheme } from '@/lib/theme';
import { RequireUser, SessionProvider, useSession } from '@/lib/session';
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
const TeamPresetsPage = lazy(() => import('@/pages/team/presets').then((m) => ({ default: m.TeamPresetsPage })));
const TeamUsagePage = lazy(() => import('@/pages/team/usage').then((m) => ({ default: m.TeamUsagePage })));
const TeamBudgetsPage = lazy(() => import('@/pages/team/budgets').then((m) => ({ default: m.TeamBudgetsPage })));
const TeamsPage = lazy(() => import('@/pages/teams').then((m) => ({ default: m.TeamsPage })));

const locale = currentLocale();
document.documentElement.lang = locale;
void startAnalytics();
watchSystemTheme();

// A sign-in return can target an edition's separately embedded app. Let the
// server load that document rather than treating it as an unknown public page.
function FallbackPage() {
  const { session } = useSession();
  const location = useLocation();
  const edition = location.pathname === "/manage" || location.pathname.startsWith("/manage/") || session.teamPages.some((page) => location.pathname.startsWith(page.path));
  useEffect(() => {
    if (edition) window.location.replace(`${location.pathname}${location.search}${location.hash}`);
  }, [edition, location]);
  return edition ? <Loading /> : <Navigate to="/teams" replace />;
}

const router = createBrowserRouter([
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
      {
        path: '/teams/:teamId',
        element: <TeamLayout />,
        children: [
          { index: true, element: <TeamOverviewPage /> },
          { path: 'models', element: <TeamModelsPage /> },
          { path: 'usage', element: <TeamUsagePage /> },
          { path: 'budgets', element: <TeamBudgetsPage /> },
          { path: 'history', element: <TeamHistoryPage /> },
          { path: 'sharing', element: <TeamSharingPage /> },
          { path: 'presets', element: <TeamPresetsPage /> },
          { path: 'plugins', element: <TeamPluginsPage /> },
          { path: 'members', element: <TeamMembersPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <FallbackPage /> },
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
