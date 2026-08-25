/**
 * HttpAdapter — REST transport for the web/browser build.
 *
 * Mirrors the PRMAdapter surface so call sites can swap
 * `new TauriAdapter()` for `new HttpAdapter(baseUrl)` without
 * touching component code.
 *
 * VITE_API_BASE: base URL for the Axum REST gateway.
 *   Reads `import.meta.env.VITE_API_BASE` (Vite env var)
 *   with a fallback to `''` (relative — same-origin via nginx).
 *   Set to `http://localhost:3000` for dev if not using Vite proxy.
 */

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

import type {
  Action,
  ApiKeyRevealed,
  ApiKeySummary,
  ArchivedItem,
  ArchiveCounts,
  ArchiveSummary,
  Contact,
  CreateActionInput,
  CreateApiKeyInput,
  CreateContactInput,
  CreateNoteInput,
  CreateEventInput,
  CreateInteractionInput,
  CreateProjectInput,
  CreateReminderInput,
  CreateTagInput,
  Event,
  GraphEdge,
  GraphResponse,
  Interaction,
  ListContactsResult,
  ListMediaParams,
  LocalUser,
  MediaItem,
  Note,
  NoteBacklink,
  NoteEntityLink,
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
  UpdateNoteInput,
  UpdateInteractionInput,
  UpdateProjectInput,
  UpdateReminderInput,
  UpdateTagInput,
  UploadMediaInput,
} from './types';

// ── API base URL ───────────────────────────────────────
const VITE_API_BASE: string = (() => {
  if (typeof import.meta === 'undefined') return '';
  const env = (import.meta as unknown as Record<string, unknown>).env as
    | Record<string, string | undefined>
    | undefined;
  return env?.VITE_API_BASE ?? '';
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

// Routes that don't require a session. Listed here (not in
// routes-config) because the 401-redirect gate fires from
// globally-mounted hooks (e.g. useReminderPoller → useLocalUser)
// that hit /api/auth/me before any route renders. Without this
// list, the very first probe bounces the visitor away from
// /forgot-password and /reset-password.
const PUBLIC_PATHNAMES: readonly string[] = [
  '/login',
  '/forgot-password',
  '/reset-password',
];

function isPublicPathname(p: string): boolean {
  return PUBLIC_PATHNAMES.some(
    (root) => p === root || p.startsWith(root + '/'),
  );
}

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
        // Only force-redirect when the user is on a route that
        // actually requires a session. Public auth-bootstrap
        // routes (/forgot-password, /reset-password) MUST stay
        // visible even when the visitor is anonymous — otherwise
        // the very first /api/auth/me probe on those pages
        // bounces them straight back to /login.
        if (!isPublicPathname(window.location.pathname)) {
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
    const err = new HttpError(`${method} ${path}: ${resp.status} ${resp.statusText} — ${msg}`, resp.status);
    throw err;
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
      user_id: string;
      tag_id?: string | null;
      search?: string | null;
      importance?: string | null;
      sort_by?: string;
      sort_dir?: string;
      limit?: number;
      offset?: number;
    }): Promise<ListContactsResult> =>
      request<{ items: Contact[]; total: number }>(this.baseUrl, 'GET', '/api/contacts' + qs({ ...p })),

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
      user_id: string;
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
      user_id: string;
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

    upcoming: (user_id: string, limit?: number | null): Promise<Event[]> =>
      request<Event[]>(
        this.baseUrl,
        'GET',
        '/api/events/upcoming' + qs({ user_id, limit }),
      ),
  };

  actions = {
    list: (p: {
      user_id: string;
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
      user_id: string;
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

  graph = {
    get: (contact_id: string, depth?: number): Promise<GraphResponse> =>
      request<GraphResponse>(
        this.baseUrl,
        'GET',
        `/api/graph/${contact_id}` + qs({ depth }),
      ),

    addRelation: (
      contact_id: string,
      body: { other_contact_id: string; label?: string | null; relation_type?: string | null; role?: string | null },
    ): Promise<GraphEdge> =>
      request<GraphEdge>(this.baseUrl, 'POST', `/api/graph/${contact_id}/relations`, body),

    removeRelation: (contact_id: string, other_id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/graph/${contact_id}/relations/${other_id}`),
  };

  reminders = {
    list: (p: {
      user_id: string;
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

  notifications = {
    show: async () => {
      throw new Error('Use browser Notification API directly on web');
    },
    requestPermission: async (): Promise<NotificationPermission> => 'default',
    permission: async (): Promise<NotificationPermission> => 'default',
  };

  tags = {
    list: (user_id: string): Promise<Tag[]> =>
      request<Tag[]>(this.baseUrl, 'GET', '/api/tags' + qs({ user_id })),

    create: (input: CreateTagInput): Promise<Tag> =>
      request<Tag>(this.baseUrl, 'POST', '/api/tags', input),

    update: (input: UpdateTagInput): Promise<Tag> =>
      request<Tag>(this.baseUrl, 'PUT', `/api/tags/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/tags/${id}`),
  };

  notes = {
    list: (_user_id: string): Promise<Note[]> =>
      request<Note[]>(this.baseUrl, 'GET', '/api/notes'),

    get: async (_user_id: string, id: string): Promise<Note | null> => {
      try {
        return await request<Note>(this.baseUrl, 'GET', `/api/notes/${id}`);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      }
    },

    create: (input: CreateNoteInput): Promise<Note> =>
      request<Note>(this.baseUrl, 'POST', '/api/notes', input),

    update: async (_user_id: string, id: string, input: UpdateNoteInput): Promise<Note | null> => {
      try {
        return await request<Note>(this.baseUrl, 'PUT', `/api/notes/${id}`, input);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      }
    },

    delete: async (_user_id: string, id: string): Promise<boolean> => {
      try {
        await request<void>(this.baseUrl, 'DELETE', `/api/notes/${id}`);
        return true;
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return false;
        throw e;
      }
    },

    listBacklinks: (
      _user_id: string,
      entity_type: string,
      entity_id: string,
    ): Promise<NoteBacklink[]> =>
      request<NoteBacklink[]>(
        this.baseUrl,
        'GET',
        '/api/notes/backlinks' + qs({ entity_type, entity_id }),
      ),
    listEntityLinks: (_user_id: string, note_id: string): Promise<NoteEntityLink[]> =>
      request<NoteEntityLink[]>(
        this.baseUrl,
        'GET',
        `/api/notes/${note_id}/entities`,
      ),
  };

  settings = {
    list: (user_id: string): Promise<Setting[]> =>
      request<Setting[]>(this.baseUrl, 'GET', '/api/settings' + qs({ user_id })),

    upsert: (user_id: string, key: string, value: string): Promise<Setting> =>
      request<Setting>(this.baseUrl, 'POST', '/api/settings/upsert', { user_id, key, value }),

    delete: (user_id: string, key: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', '/api/settings' + qs({ user_id, key })),
  };

  search = {
    query: (
      user_id: string,
      query: string,
      limit?: number | null,
      options?: { include_archived?: boolean | null },
    ): Promise<SearchResults> =>
      request<SearchResults>(
        this.baseUrl,
        'GET',
        '/api/search' +
          qs({
            user_id,
            // WHY `q` not `query`: backend QueryParams expects `q`; sending `query=` → 422 (every search panel renders empty).
            q: query,
            limit: limit ?? null,
            include_archived: options?.include_archived ?? true,
          }),
      ),
  };

  archive = {
    summary: (user_id: string): Promise<ArchiveSummary> =>
      request<ArchiveSummary>(this.baseUrl, 'GET', '/api/archive/summary' + qs({ user_id })),

    counts: (user_id: string): Promise<ArchiveCounts> =>
      request<ArchiveCounts>(this.baseUrl, 'GET', '/api/archive/counts' + qs({ user_id })),

    list: (
      user_id: string,
      entity: 'action' | 'event' | 'project',
    ): Promise<ArchivedItem[]> =>
      request<ArchivedItem[]>(
        this.baseUrl,
        'GET',
        '/api/archive/list' + qs({ user_id, entity, limit: 500 }),
      ),

    unarchiveOne: (
      user_id: string,
      entity: 'action' | 'event' | 'project',
      id: string,
    ): Promise<void> =>
      request<void>(this.baseUrl, 'POST', '/api/archive/unarchive-one', {
        user_id,
        entity,
        id,
      }),

    bulkUnarchive: (
      user_id: string,
      entity: 'action' | 'event' | 'project',
    ): Promise<{ unarchived: number }> =>
      request<{ unarchived: number }>(
        this.baseUrl,
        'POST',
        '/api/archive/bulk-unarchive',
        { user_id, entity },
      ),

    sweep: (user_id: string): Promise<{ archived: number }> =>
      request<{ archived: number }>(
        this.baseUrl,
        'POST',
        '/api/archive/sweep',
        { user_id },
      ),
  };

  cloud = {
    status: () => Promise.reject(new Error('cloud sync is desktop-only')),
    login: () => Promise.reject(new Error('cloud sync is desktop-only')),
    logout: () => Promise.reject(new Error('cloud sync is desktop-only')),
    syncNow: () => Promise.reject(new Error('cloud sync is desktop-only')),
  };

  apiKeys = {
    list: (user_id: string): Promise<ApiKeySummary[]> =>
      request<ApiKeySummary[]>(this.baseUrl, 'GET', `/api/api_keys${qs({ user_id })}`),
    create: (
      user_id: string,
      input: CreateApiKeyInput,
    ): Promise<ApiKeyRevealed & { name: string; prefix: string; last4: string; created_at: string }> =>
      request<ApiKeyRevealed & { name: string; prefix: string; last4: string; created_at: string }>(
        this.baseUrl,
        'POST',
        '/api/api_keys',
        { user_id, ...input },
      ),
    reveal: (user_id: string, id: string): Promise<ApiKeyRevealed> =>
      request<ApiKeyRevealed>(
        this.baseUrl,
        'GET',
        `/api/api_keys/${encodeURIComponent(id)}/plaintext${qs({ user_id })}`,
      ),
    revoke: (user_id: string, id: string): Promise<void> =>
      request<void>(
        this.baseUrl,
        'DELETE',
        `/api/api_keys/${encodeURIComponent(id)}${qs({ user_id })}`,
      ),
  };

  media = {
    upload: async (input: UploadMediaInput): Promise<MediaItem> => {
      const form = new FormData();
      form.append('kind', input.kind);
      form.append('owner_type', input.owner_type);
      form.append('owner_id', input.owner_id);
      const blob = new Blob([input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength) as ArrayBuffer], { type: input.mime });
      form.append('file', blob, input.filename ?? 'upload');
      const token = getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      console.log('[avatar-upload] fetch start: kind=', input.kind, 'owner_type=', input.owner_type, 'owner_id=', input.owner_id, 'mime=', input.mime, 'bytes=', input.bytes.byteLength, 'token=', token ? `present(${token.slice(0, 12)}…)` : 'MISSING');
      const resp = await fetch(
        buildUrl(this.baseUrl, '/api/media', 'POST'),
        { method: 'POST', headers, body: form },
      );
      console.log('[avatar-upload] fetch done: status=', resp.status, resp.statusText);
      if (!resp.ok) {
        let msg = '';
        try { msg = await resp.text(); } catch { msg = ''; }
        console.log('[avatar-upload] fetch failed body=', msg);
        throw new Error(`POST /api/media: ${resp.status} ${resp.statusText} — ${msg}`);
      }
      const data = (await resp.json()) as MediaItem;
      console.log('[avatar-upload] fetch ok, media=', data);
      return data;
    },

    url: async (id: string): Promise<string> => {
      const item = await request<MediaItem>(
        this.baseUrl,
        'GET',
        `/api/media/${encodeURIComponent(id)}`,
      );
      return buildUrl(this.baseUrl, `/files/${item.storage_key}`, 'GET');
    },

    listByOwner: (p: ListMediaParams): Promise<MediaItem[]> =>
      request<MediaItem[]>(
        this.baseUrl,
        'GET',
        '/api/media' + qs({
          kind: p.kind,
          owner_type: p.owner_type,
          owner_id: p.owner_id,
        }),
      ),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/api/media/${encodeURIComponent(id)}`),
  };
}
