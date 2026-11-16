import './globals.css';
import { TeamsPage, TeamPage, SystemPage } from './pages/system';
import { configureNavigation, type NavItem } from './components/layout/nav';
import { configureBase } from './lib/base';
import type { RouteObject } from 'react-router';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from 'react-router';
import { Toaster } from 'sonner';

import { MobileNav, Sidebar } from './components/layout/sidebar';
import { AdminProvider, RequireAdmin, useAdmin } from './lib/session';
import { applyTheme } from './lib/theme';
import { DashboardPage } from './pages/dashboard';
import { DeniedPage } from './pages/denied';
import { LoginPage } from './pages/login';
import { UsersPage } from './pages/users';

applyTheme();

/**
 * The rail and the content column scroll independently: a long nav must not
 * drag the table out of view, nor a long table push sign-out off the bottom.
 */
function Shell() {
  const { who } = useAdmin();
  const email = who.kind === 'admin' ? who.email : '';
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar email={email} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileNav email={email} />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function mountAdmin({
  base = '/manage',
  googleOnly = false,
  extraRoutes = [],
  extraNav = [],
}: {
  base?: string;
  googleOnly?: boolean;
  extraRoutes?: RouteObject[];
  extraNav?: NavItem[];
} = {}) {
  configureBase(base, googleOnly);
  configureNavigation(extraNav);
  const router = createBrowserRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/denied', element: <DeniedPage /> },
      {
        element: <RequireAdmin />,
        children: [
          {
            element: <Shell />,
            children: [
              { path: '/', element: <DashboardPage /> },
              { path: '/users', element: <UsersPage /> },
              { path: '/teams', element: <TeamsPage /> },
              { path: '/teams/:id', element: <TeamPage /> },
              { path: '/system', element: <SystemPage /> },
              ...extraRoutes,
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
    { basename: base || '/' },
  );

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AdminProvider>
        <RouterProvider router={router} />
        <Toaster richColors />
      </AdminProvider>
    </StrictMode>,
  );
}
