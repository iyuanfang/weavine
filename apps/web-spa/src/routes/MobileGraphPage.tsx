import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { HomeGraph } from '../components/HomeGraph';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';

/**
 * Full-screen mobile graph. Opened from the Today page's 🕸️ button; no
 * drawer, no bottom nav (BottomNav hides itself on this path — see
 * isFullScreenRoute), just the me-centered weave and a close button.
 */
export function MobileGraphPage() {
  const navigate = useNavigate();
  const adapter = useAdapter();
  const userId = useUserId() ?? '';

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId, 'for-suggestions'],
    queryFn: () =>
      adapter.contacts.list({
        user_id: userId,
        sort_by: 'last_interaction_at',
        limit: 200,
      }),
    enabled: Boolean(userId),
  });
  const eventsQuery = useQuery({
    queryKey: ['events', userId, 'upcoming-for-today'],
    queryFn: () => adapter.events.upcoming(userId, 10),
    enabled: Boolean(userId),
  });
  const actionsQuery = useQuery({
    queryKey: ['actions', userId, 'all-for-today'],
    queryFn: () =>
      adapter.actions.list({ user_id: userId, archived: 'false', limit: 200 }),
    enabled: Boolean(userId),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', userId, 'active-for-today'],
    queryFn: () =>
      adapter.projects.list({ user_id: userId, archived: 'false', limit: 200 }),
    enabled: Boolean(userId),
  });
  const interactionsQuery = useQuery({
    queryKey: ['interactions', userId, 'recent-for-today'],
    queryFn: () => adapter.interactions.list({ user_id: userId, limit: 20 }),
    enabled: Boolean(userId),
  });
  const notesQuery = useQuery({
    // DISTINCT key — Today's 'for-home-graph' query with the same key caches
    // {graph, all}, and this page consumed that object as an array, crashing
    // HomeGraph with "TypeError: i is not iterable" (and, in the other
    // direction, silently emptying Today's graph).
    queryKey: ['notes', userId, 'for-mobile-graph-page'],
    queryFn: async () => {
      const r = await adapter.notes.list(userId);
      const top = r.items.slice(0, 5);
      return Promise.all(
        top.map(async (n) => {
          try {
            const links = await adapter.notes.listEntityLinks(userId, n.id);
            return {
              id: n.id,
              title: n.title,
              linkedContactIds: links
                .filter((l) => l.entity_type === 'contact')
                .map((l) => l.entity_id),
            };
          } catch {
            return { id: n.id, title: n.title, linkedContactIds: [] as string[] };
          }
        }),
      );
    },
    enabled: Boolean(userId),
  });

  return (
    <div className="mobile-graph" data-testid="mobile-graph">
      <div className="mobile-graph__topbar">
        <button
          type="button"
          className="today-mobile__topbar-btn"
          onClick={() => navigate('/today', { replace: true })}
          aria-label="关闭关系图"
          data-testid="mobile-graph-close"
        >
          ✕
        </button>
        <span className="mobile-graph__title">我的关系图</span>
        <span style={{ width: 40 }} />
      </div>
      <div className="mobile-graph__canvas">
        <HomeGraph
          contacts={contactsQuery.data?.items ?? []}
          events={eventsQuery.data ?? []}
          actions={actionsQuery.data ?? []}
          projects={projectsQuery.data ?? []}
          notes={notesQuery.data ?? []}
          interactions={interactionsQuery.data ?? []}
          preparing={false}
        />
      </div>
    </div>
  );
}
