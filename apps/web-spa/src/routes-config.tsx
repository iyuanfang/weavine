// Centralized route registry. Each page exports a `RouteConfig`
// entry; main.tsx iterates this list to build the router. This
// lets parallel page-migration subagents add their route without
// each editing main.tsx (which would cause merge conflicts).

import type { ComponentType, LazyExoticComponent } from 'react';
import type { RouteObject } from 'react-router-dom';

import { Providers } from './App';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './lib/auth/RequireAuth';
import { LoginPage } from './routes/Login';
import { TodayPage } from './routes/Today';
import { ContactsList } from './routes/ContactsList';
import { ContactNew } from './routes/ContactNew';
import { ContactEdit } from './routes/ContactEdit';
import { ContactDetail } from './routes/ContactDetail';
import { Calendar } from './routes/Calendar';
import { EventNew } from './routes/EventNew';
import { EventEdit } from './routes/EventEdit';
import { EventDetail } from './routes/EventDetail';
import { ProjectsList } from './routes/ProjectsList';
import { ProjectNew } from './routes/ProjectNew';
import { ProjectDetail } from './routes/ProjectDetail';
import { ProjectEdit } from './routes/ProjectEdit';
import { ActionsList } from './routes/ActionsList';
import { ActionNew } from './routes/ActionNew';
import { ActionEdit } from './routes/ActionEdit';
import { ActionDetail } from './routes/ActionDetail';
import { Reminders } from './routes/Reminders';
import { Tags } from './routes/Tags';
import { TagDetail } from './routes/TagDetail';
import { InteractionDetail } from './routes/InteractionDetail';
import { SearchPage } from './routes/Search';
import { SettingsPage } from './routes/Settings';
import { ApiKeysPage } from './routes/ApiKeys';
import ArchivePage from './routes/Archive';

export interface AppRoute {
  /** React Router path pattern, e.g. `/contacts/:id`. */
  path: string;
  /** Component to render inside <App> (shell + query provider). */
  Component: ComponentType | LazyExoticComponent<ComponentType>;
  /**
   * Short label shown in dev-only breadcrumbs / error pages.
   * Not user-facing.
   */
  label: string;
  /** Render outside the AppShell (e.g. login). Default false. */
  bare?: boolean;
}

/**
 * The single source of truth for all web-spa routes. Add a
 * page by appending an entry here and importing the component
 * above. Do NOT edit main.tsx directly — it iterates this list.
 */
export const routes: AppRoute[] = [
  { path: '/login', Component: LoginPage, label: 'Login', bare: true },
  { path: '/today', Component: TodayPage, label: 'Today' },

  // Placeholder entries below — replaced as Phase 4 lands.
  // Each migration subagent removes its placeholder and
  // imports the real component instead.
  { path: '/contacts', Component: ContactsList, label: 'Contacts' },
  { path: '/contacts/:id', Component: ContactDetail, label: 'ContactDetail' },
  { path: '/contacts/:id/edit', Component: ContactEdit, label: 'ContactEdit' },
  { path: '/contacts/new', Component: ContactNew, label: 'ContactNew' },
  { path: '/calendar', Component: Calendar, label: 'Calendar' },
  { path: '/events/:id', Component: EventDetail, label: 'EventDetail' },
  { path: '/events/:id/edit', Component: EventEdit, label: 'EventEdit' },
  { path: '/events/new', Component: EventNew, label: 'EventNew' },
  { path: '/actions', Component: ActionsList, label: 'Actions' },
  { path: '/actions/:id', Component: ActionDetail, label: 'ActionDetail' },
  { path: '/actions/:id/edit', Component: ActionEdit, label: 'ActionEdit' },
  { path: '/actions/new', Component: ActionNew, label: 'ActionNew' },
  { path: '/projects', Component: ProjectsList, label: 'ProjectsList' },
  { path: '/projects/new', Component: ProjectNew, label: 'ProjectNew' },
  { path: '/projects/:id', Component: ProjectDetail, label: 'ProjectDetail' },
  { path: '/projects/:id/edit', Component: ProjectEdit, label: 'ProjectEdit' },
  { path: '/interactions/:id', Component: InteractionDetail, label: 'InteractionDetail' },
  { path: '/reminders', Component: Reminders, label: 'Reminders' },
  { path: '/tags', Component: Tags, label: 'Tags' },
  { path: '/tags/:tagId', Component: TagDetail, label: 'TagDetail' },
  { path: '/search', Component: SearchPage, label: 'Search' },
  { path: '/settings', Component: SettingsPage, label: 'Settings' },
  { path: '/settings/api-keys', Component: ApiKeysPage, label: 'API 密钥' },
  { path: '/archive', Component: ArchivePage, label: 'Archive' },
];

/**
 * Build the React Router v6 data object array.
 *
 *   bare=true   → just <Providers> (QueryClient + adapter). Used for /login.
 *   bare=false  → <RequireAuth> → <Providers> → <AppShell> + page. On web,
 *                 RequireAuth gates on a valid JWT in localStorage.
 */
export function buildRouterObjects(): RouteObject[] {
  return routes.map(({ path, Component, bare }) => ({
    path,
    element: bare ? (
      <Providers>
        <Component />
      </Providers>
    ) : (
      <RequireAuth>
        <Providers>
          <AppShell>
            <Component />
          </AppShell>
        </Providers>
      </RequireAuth>
    ),
  }));
}