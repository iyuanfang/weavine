// Auth gate for the web SPA. Web → require a JWT session. Desktop → pass.

import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAdapter, isTauri } from '../adapter';
import { loadSession } from './storage';

interface Props {
  children: React.ReactNode;
}

/**
 * Web-mode auth gate. Wraps any route that needs a logged-in user.
 *
 * Desktop: pass-through (single-user model, no login required).
 * Web: require a JWT in localStorage. Verify it with `/api/auth/me`; on 401
 * or absent token, redirect to `/login?next=<encoded current path>`.
 */
export function RequireAuth({ children }: Props) {
  const adapter = useAdapter();
  const location = useLocation();
  const [state, setState] = useState<
    | { kind: 'pass' }
    | { kind: 'redirect'; to: string }
    | { kind: 'loading' }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    if (isTauri) {
      if (!cancelled) setState({ kind: 'pass' });
      return () => {
        cancelled = true;
      };
    }

    const session = loadSession();
    if (!session) {
      const next = encodeURIComponent(location.pathname + location.search);
      if (!cancelled) setState({ kind: 'redirect', to: `/login?next=${next}` });
      return () => {
        cancelled = true;
      };
    }

    fetch((adapter as unknown as { baseUrl: string }).baseUrl + '/api/auth/me', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setState({ kind: 'pass' });
        } else if (r.status === 401) {
          const next = encodeURIComponent(location.pathname + location.search);
          setState({ kind: 'redirect', to: `/login?next=${next}` });
        } else {
          // transient: let them in; per-call 401s still get caught by http.ts
          setState({ kind: 'pass' });
        }
      })
      .catch(() => {
        if (cancelled) return;
        // offline-ish: optimistic; http.ts handles real 401s
        setState({ kind: 'pass' });
      });

    return () => {
      cancelled = true;
    };
  }, [adapter, location.pathname, location.search]);

  if (state.kind === 'loading') {
    return <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>加载中…</div>;
  }
  if (state.kind === 'redirect') {
    return <Navigate to={state.to} replace />;
  }
  return <>{children}</>;
}
