// Centralized route registry. Each page exports a `RouteConfig`
// entry; main.tsx iterates this list to build the router. This
// lets parallel page-migration subagents add their route without
// each editing main.tsx (which would cause merge conflicts).

import type { ComponentType, LazyExoticComponent } from 'react';
import type { RouteObject } from 'react-router-dom';

import { App } from './App';
import { TodayPage } from './routes/Today';
import { ContactsList } from './routes/ContactsList';
import { ContactNew } from './routes/ContactNew';
import { ContactEdit } from './routes/ContactEdit';
import { ContactDetail } from './routes/ContactDetail';
import { Calendar } from './routes/Calendar';
import { EventNew } from './routes/EventNew';
import { EventEdit } from './routes/EventEdit';
import { EventDetail } from './routes/EventDetail';
import { ActionsList } from './routes/ActionsList';
import { ActionNew } from './routes/ActionNew';
import { ActionEdit } from './routes/ActionEdit';
import { ActionDetail } from './routes/ActionDetail';

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
}

/**
 * The single source of truth for all web-spa routes. Add a
 * page by appending an entry here and importing the component
 * above. Do NOT edit main.tsx directly — it iterates this list.
 */
export const routes: AppRoute[] = [
  { path: '/', Component: TodayPage, label: 'Today' },

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
  { path: '/interactions/:id', Component: () => <div className="loading">互动详情（Phase 4 进行中）</div>, label: 'InteractionDetail (placeholder)' },
  { path: '/reminders', Component: () => <div className="loading">提醒（Phase 4 进行中）</div>, label: 'Reminders (placeholder)' },
  { path: '/tags', Component: () => <div className="loading">标签（Phase 4 进行中）</div>, label: 'Tags (placeholder)' },
  { path: '/tags/:tagId', Component: () => <div className="loading">标签详情（Phase 4 进行中）</div>, label: 'TagDetail (placeholder)' },
  { path: '/search', Component: () => <div className="loading">搜索（Phase 4 进行中）</div>, label: 'Search (placeholder)' },
  { path: '/settings', Component: () => <div className="loading">设置（Phase 4 进行中）</div>, label: 'Settings (placeholder)' },
];

/**
 * Build the React Router v6 data object array. Wraps every
 * route element in <App> so the QueryClient / adapter / shell
 * are always available, regardless of which page mounts.
 */
export function buildRouterObjects(): RouteObject[] {
  return routes.map(({ path, Component }) => ({
    path,
    element: (
      <App>
        <Component />
      </App>
    ),
  }));
}