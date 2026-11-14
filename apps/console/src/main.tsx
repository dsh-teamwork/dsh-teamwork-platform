import './globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { IntlProvider } from 'use-intl';

import { startAnalytics } from '@/lib/analytics';
import { currentLocale } from '@/lib/locale';
import { RequireUser, SessionProvider } from '@/lib/session';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';
import { AccountPage } from '@/pages/account';
import { PasswordPage } from '@/pages/password';
import { PluginPage } from '@/pages/plugin';
import { SetupPage } from '@/pages/setup';
import { SignInPage } from '@/pages/sign-in';
import { TeamLayout } from '@/pages/team/layout';
import { TeamMembersPage } from '@/pages/team/members';
import { TeamModelsPage } from '@/pages/team/models';
import { TeamOverviewPage } from '@/pages/team/overview';
import { TeamPluginsPage } from '@/pages/team/plugins';
import { TeamPresetsPage } from '@/pages/team/presets';
import { TeamsPage } from '@/pages/teams';

const locale = currentLocale();
document.documentElement.lang = locale;
void startAnalytics();

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
          { path: 'presets', element: <TeamPresetsPage /> },
          { path: 'plugins', element: <TeamPluginsPage /> },
          { path: 'members', element: <TeamMembersPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/teams" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IntlProvider locale={locale} messages={locale === 'zh-CN' ? zhCN : en} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
      <SessionProvider>
        <RouterProvider router={router} />
        <Toaster richColors />
      </SessionProvider>
    </IntlProvider>
  </StrictMode>,
);
