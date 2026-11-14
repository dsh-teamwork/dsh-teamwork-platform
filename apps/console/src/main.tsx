import './globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { IntlProvider } from 'use-intl';

import { currentLocale } from '@/lib/locale';
import { SessionProvider } from '@/lib/session';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';
import { PasswordPage } from '@/pages/password';
import { PluginPage } from '@/pages/plugin';
import { SetupPage } from '@/pages/setup';
import { SignInPage } from '@/pages/sign-in';
import { TeamsPage } from '@/pages/teams';

const locale = currentLocale();
document.documentElement.lang = locale;

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/teams" replace /> },
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/password', element: <PasswordPage /> },
  { path: '/plugin', element: <PluginPage /> },
  { path: '/teams', element: <TeamsPage /> },
  { path: '*', element: <Navigate to="/teams" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IntlProvider locale={locale} messages={locale === 'zh-CN' ? zhCN : en} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </IntlProvider>
  </StrictMode>,
);
