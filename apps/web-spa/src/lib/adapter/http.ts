/**
 * HttpAdapter — REST transport for the web/browser build.
 *
 * Mirrors the PRMAdapter surface so call sites can swap
 * `new TauriAdapter()` for `new HttpAdapter(baseUrl)` without
 * touching component code.
 *
 * VITE_API_BASE: base URL for the Axum REST gateway.
 *   Reads `import.meta.env.VITE_API_BASE` (Vite env var)
 *   with a fallback to `http://localhost:3000`.
 */

import type {
  Action,
  ArchivedItem,
  ArchiveCounts,
  ArchiveSummary,
  Contact,
  CreateActionInput,
  CreateContactInput,
  CreateEventInput,
  CreateInteractionInput,
  CreateProjectInput,
  CreateReminderInput,
  CreateTagInput,
  Event,
  Interaction,
  LocalUser,
  PRMAdapter,
  Project,
  ProjectContactWithContact,
  Reminder,
  SearchResults,
  Setting,
  StartupInfo,
  Tag,
  UpdateActionInput,
  UpdateContactInput,
  UpdateEventInput,
  UpdateInteractionInput,
  UpdateProjectInput,
  UpdateReminderInput,
  UpdateTagInput,
} from './types';

// ── API base URL ───────────────────────────────────────
const VITE_API_BASE: string = (() => {
  if (typeof import.meta === 'undefined') return 'http://localhost:3000';
  const env = (import.meta as unknown as Record<string, unknown>).env as
    | Record<string, string | undefined>
    | undefined;
  return env?.VITE_API_BASE ?? 'http://localhost:3000';
})();

// ── Auth helper ────────────────────────────────────────

import { clearSession, getAccessToken } from '../auth/storage';

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ── Fetch helper ───────────────────────────────────────

function buildUrl(baseUrl: string, path: string, method: string): string {
  const url = baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
  if (method === 'GET' || method === 'HEAD') {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_t=${Date.now()}`;
  }
  return url;
}

async function request<R>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<R> {
  const url = buildUrl(baseUrl, path, method);
  const opts: RequestInit = {
    method,
    headers: authHeaders(),
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(url, opts);

  if (!resp.ok) {
    if (resp.status === 401 && typeof window !== 'undefined') {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}`);
      }
    }
    let msg: string;
    try {
      msg = await resp.text();
    } catch {
      msg = `HTTP ${resp.status} ${resp.statusText}`;
    }
    throw new Error(`${method} ${path}: ${resp.status} ${resp.statusText} — ${msg}`);
  }

  // Empty body (204 No Content, etc.)
  if (resp.status === 204) return undefined as R;
  return resp.json() as Promise<R>;
}

// ── Query-string builder ───────────────────────────────

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const entries: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    entries.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return entries.length > 0 ? '?' + entries.join('&') : '';
}

// ── Adapter ────────────────────────────────────────────

export class HttpAdapter implements PRMAdapter {
  constructor(public baseUrl: string = VITE_API_BASE) {}

  getLocalUser(): Promise<LocalUser> {
    return request<Record<string, unknown>>(
      this.baseUrl,
      'GET',
      '/api/auth/me',
    ).then((r) => ({
      id: (r.id ?? r.user_id ?? '') as string,
      name: null,
      email: (r.email as string | null) ?? null,
    }));
  }

  getStartupInfo(): Promise<StartupInfo> {
    return request<StartupInfo>(this.baseUrl, 'GET', '/api/diagnostic/startup');
  }

  contacts = {
    list: (p: {
      owner_id: string;
      tag_id?: string | null;
      search?: string | null;
      importance?: string | null;
    }): Promise<Contact[]> =>
      request<Contact[]>(this.baseUrl, 'GET', '/api/contacts' + qs({ ...p })),

    get: (id: string): Promise<Contact> =>
      request<Contact>(this.baseUrl, 'GET', `/api/contacts/${id}`),

    create: (input: CreateContactInput): Promise<Contact> =>
      request<Contact>(this.baseUrl, 'POST', '/api/contacts', input),

    update: (input: UpdateContactInput): Promise<Contact> =>
      request<Contact>(this.baseUrl, 'PUT', `/api/contacts/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/contacts/${id}`),
  };

  projects = {
    list: (p: {
      owner_id: string;
      template?: string | null;
      stage?: string | null;
      limit?: number | null;
    }): Promise<Project[]> =>
      request<Project[]>(this.baseUrl, 'GET', '/api/projects' + qs({ ...p })),

    get: (id: string): Promise<Project> =>
      request<Project>(this.baseUrl, 'GET', `/api/projects/${id}`),

    create: (input: CreateProjectInput): Promise<Project> =>
      request<Project>(this.baseUrl, 'POST', '/api/projects', input),

    update: (input: UpdateProjectInput): Promise<Project> =>
      request<Project>(this.baseUrl, 'PUT', `/api/projects/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/projects/${id}`),

    stages: (template: string): Promise<string[]> =>
      request<string[]>(this.baseUrl, 'GET', '/api/projects/stages' + qs({ template })),
  };

  events = {
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      project_id?: string | null;
      start_after?: string | null;
      start_before?: string | null;
      limit?: number | null;
    }): Promise<Event[]> =>
      request<Event[]>(this.baseUrl, 'GET', '/api/events' + qs({ ...p })),

    get: (id: string): Promise<Event> =>
      request<Event>(this.baseUrl, 'GET', `/api/events/${id}`),

    create: (input: CreateEventInput): Promise<Event> =>
      request<Event>(this.baseUrl, 'POST', '/api/events', input),

    update: (input: UpdateEventInput): Promise<Event> =>
      request<Event>(this.baseUrl, 'PUT', `/api/events/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/events/${id}`),

    upcoming: (owner_id: string, limit?: number | null): Promise<Event[]> =>
      request<Event[]>(
        this.baseUrl,
        'GET',
        '/api/events/upcoming' + qs({ owner_id, limit }),
      ),
  };

  actions = {
    list: (p: {
      owner_id: string;
      status?: string | null;
      contact_id?: string | null;
      project_id?: string | null;
      limit?: number | null;
    }): Promise<Action[]> =>
      request<Action[]>(this.baseUrl, 'GET', '/api/actions' + qs({ ...p })),

    get: (id: string): Promise<Action> =>
      request<Action>(this.baseUrl, 'GET', `/api/actions/${id}`),

    create: (input: CreateActionInput): Promise<Action> =>
      request<Action>(this.baseUrl, 'POST', '/api/actions', input),

    update: (input: UpdateActionInput): Promise<Action> =>
      request<Action>(this.baseUrl, 'PUT', `/api/actions/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/actions/${id}`),
  };

  projectContacts = {
    list: (project_id: string): Promise<ProjectContactWithContact[]> =>
      request<ProjectContactWithContact[]>(
        this.baseUrl,
        'GET',
        `/api/projects/${project_id}/contacts`,
      ),

    add: (project_id: string, contact_id: string, role?: string | null): Promise<void> =>
      request<void>(this.baseUrl, 'POST', `/api/projects/${project_id}/contacts`, {
        contact_id,
        role: role ?? null,
      }),

    remove: (project_id: string, contact_id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/projects/${project_id}/contacts/${contact_id}`),
  };

  interactions = {
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      action_id?: string | null;
      event_id?: string | null;
      limit?: number | null;
    }): Promise<Interaction[]> =>
      request<Interaction[]>(this.baseUrl, 'GET', '/api/interactions' + qs({ ...p })),

    get: (id: string): Promise<Interaction> =>
      request<Interaction>(this.baseUrl, 'GET', `/api/interactions/${id}`),

    create: (input: CreateInteractionInput): Promise<Interaction> =>
      request<Interaction>(this.baseUrl, 'POST', '/api/interactions', input),

    update: (input: UpdateInteractionInput): Promise<Interaction> =>
      request<Interaction>(this.baseUrl, 'PUT', `/api/interactions/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/interactions/${id}`),
  };

  reminders = {
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      event_id?: string | null;
      include_dismissed?: boolean | null;
      limit?: number | null;
    }): Promise<Reminder[]> =>
      request<Reminder[]>(this.baseUrl, 'GET', '/api/reminders' + qs({ ...p })),

    create: (input: CreateReminderInput): Promise<Reminder> =>
      request<Reminder>(this.baseUrl, 'POST', '/api/reminders', input),

    update: (input: UpdateReminderInput): Promise<Reminder> =>
      request<Reminder>(this.baseUrl, 'PUT', `/api/reminders/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/reminders/${id}`),

    dismiss: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'POST', `/api/reminders/${id}/dismiss`),
  };

  tags = {
    list: (owner_id: string): Promise<Tag[]> =>
      request<Tag[]>(this.baseUrl, 'GET', '/api/tags' + qs({ owner_id })),

    create: (input: CreateTagInput): Promise<Tag> =>
      request<Tag>(this.baseUrl, 'POST', '/api/tags', input),

    update: (input: UpdateTagInput): Promise<Tag> =>
      request<Tag>(this.baseUrl, 'PUT', `/api/tags/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/tags/${id}`),
  };

  settings = {
    list: (owner_id: string): Promise<Setting[]> =>
      request<Setting[]>(this.baseUrl, 'GET', '/api/settings' + qs({ owner_id })),

    upsert: (owner_id: string, key: string, value: string): Promise<Setting> =>
      request<Setting>(this.baseUrl, 'POST', '/api/settings/upsert', { owner_id, key, value }),

    delete: (owner_id: string, key: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', '/api/settings' + qs({ owner_id, key })),
  };

  search = {
    query: (
      owner_id: string,
      query: string,
      limit?: number | null,
      options?: { include_archived?: boolean | null },
    ): Promise<SearchResults> =>
      request<SearchResults>(
        this.baseUrl,
        'GET',
        '/api/search' +
          qs({
            owner_id,
            query,
            limit: limit ?? null,
            include_archived: options?.include_archived ?? true,
          }),
      ),
  };

  archive = {
    summary: (owner_id: string): Promise<ArchiveSummary> =>
      request<ArchiveSummary>(this.baseUrl, 'GET', '/api/archive/summary' + qs({ owner_id })),

    counts: (owner_id: string): Promise<ArchiveCounts> =>
      request<ArchiveCounts>(this.baseUrl, 'GET', '/api/archive/counts' + qs({ owner_id })),

    list: (
      owner_id: string,
      entity: 'action' | 'event' | 'project',
    ): Promise<ArchivedItem[]> =>
      request<ArchivedItem[]>(
        this.baseUrl,
        'GET',
        '/api/archive/list' + qs({ owner_id, entity, limit: 500 }),
      ),

    unarchiveOne: (
      owner_id: string,
      entity: 'action' | 'event' | 'project',
      id: string,
    ): Promise<void> =>
      request<void>(this.baseUrl, 'POST', '/api/archive/unarchive-one', {
        owner_id,
        entity,
        id,
      }),

    bulkUnarchive: (
      owner_id: string,
      entity: 'action' | 'event' | 'project',
    ): Promise<{ unarchived: number }> =>
      request<{ unarchived: number }>(
        this.baseUrl,
        'POST',
        '/api/archive/bulk-unarchive',
        { owner_id, entity },
      ),
  };
}
