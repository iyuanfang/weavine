/**
 * HttpAdapter — REST transport for the web/browser build.
 *
 * Mirrors the PRMAdapter surface so call sites can swap
 * `new TauriAdapter()` for `new HttpAdapter(baseUrl)` without
 * touching component code.
 *
 * VITE_API_BASE: base URL for the Axum REST gateway.
 *   Reads `import.meta.env.VITE_API_BASE` (Vite env var)
 *   with a fallback to `http://localhost:3199`.
 */

import type {
  Action,
  Contact,
  CreateActionInput,
  CreateContactInput,
  CreateEventInput,
  CreateInteractionInput,
  CreateReminderInput,
  CreateTagInput,
  Event,
  Interaction,
  LocalUser,
  PRMAdapter,
  Reminder,
  SearchResults,
  Setting,
  StartupInfo,
  Tag,
  UpdateActionInput,
  UpdateContactInput,
  UpdateEventInput,
  UpdateInteractionInput,
  UpdateReminderInput,
  UpdateTagInput,
} from './types';

// ── API base URL ───────────────────────────────────────
const VITE_API_BASE: string = (() => {
  if (typeof import.meta === 'undefined') return 'http://localhost:3199';
  const env = (import.meta as unknown as Record<string, unknown>).env as
    | Record<string, string | undefined>
    | undefined;
  return env?.VITE_API_BASE ?? 'http://localhost:3199';
})();

// ── Auth helper ────────────────────────────────────────

function getBearerToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('prm_token');
}

function authHeaders(): Record<string, string> {
  const token = getBearerToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ── Fetch helper ───────────────────────────────────────

function buildUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

async function request<R>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<R> {
  const url = buildUrl(baseUrl, path);
  const opts: RequestInit = {
    method,
    headers: authHeaders(),
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(url, opts);

  if (!resp.ok) {
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
    return request<LocalUser>(this.baseUrl, 'GET', '/diagnostic/user');
  }

  getStartupInfo(): Promise<StartupInfo> {
    return request<StartupInfo>(this.baseUrl, 'GET', '/diagnostic/startup');
  }

  contacts = {
    list: (p: {
      owner_id: string;
      tag_id?: string | null;
      search?: string | null;
      importance?: string | null;
    }): Promise<Contact[]> =>
      request<Contact[]>(this.baseUrl, 'GET', '/contacts' + qs({ ...p })),

    get: (id: string): Promise<Contact> =>
      request<Contact>(this.baseUrl, 'GET', `/contacts/${id}`),

    create: (input: CreateContactInput): Promise<Contact> =>
      request<Contact>(this.baseUrl, 'POST', '/contacts', input),

    update: (input: UpdateContactInput): Promise<Contact> =>
      request<Contact>(this.baseUrl, 'PUT', `/contacts/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/contacts/${id}`),
  };

  events = {
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      start_after?: string | null;
      start_before?: string | null;
      limit?: number | null;
    }): Promise<Event[]> =>
      request<Event[]>(this.baseUrl, 'GET', '/events' + qs({ ...p })),

    get: (id: string): Promise<Event> =>
      request<Event>(this.baseUrl, 'GET', `/events/${id}`),

    create: (input: CreateEventInput): Promise<Event> =>
      request<Event>(this.baseUrl, 'POST', '/events', input),

    update: (input: UpdateEventInput): Promise<Event> =>
      request<Event>(this.baseUrl, 'PUT', `/events/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/events/${id}`),

    upcoming: (owner_id: string, limit?: number | null): Promise<Event[]> =>
      request<Event[]>(
        this.baseUrl,
        'GET',
        '/events/upcoming' + qs({ owner_id, limit }),
      ),
  };

  actions = {
    list: (p: {
      owner_id: string;
      status?: string | null;
      contact_id?: string | null;
      event_id?: string | null;
      limit?: number | null;
    }): Promise<Action[]> =>
      request<Action[]>(this.baseUrl, 'GET', '/actions' + qs({ ...p })),

    get: (id: string): Promise<Action> =>
      request<Action>(this.baseUrl, 'GET', `/actions/${id}`),

    create: (input: CreateActionInput): Promise<Action> =>
      request<Action>(this.baseUrl, 'POST', '/actions', input),

    update: (input: UpdateActionInput): Promise<Action> =>
      request<Action>(this.baseUrl, 'PUT', `/actions/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/actions/${id}`),
  };

  interactions = {
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      action_id?: string | null;
      event_id?: string | null;
      limit?: number | null;
    }): Promise<Interaction[]> =>
      request<Interaction[]>(this.baseUrl, 'GET', '/interactions' + qs({ ...p })),

    get: (id: string): Promise<Interaction> =>
      request<Interaction>(this.baseUrl, 'GET', `/interactions/${id}`),

    create: (input: CreateInteractionInput): Promise<Interaction> =>
      request<Interaction>(this.baseUrl, 'POST', '/interactions', input),

    update: (input: UpdateInteractionInput): Promise<Interaction> =>
      request<Interaction>(this.baseUrl, 'PUT', `/interactions/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/interactions/${id}`),
  };

  reminders = {
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      event_id?: string | null;
      include_dismissed?: boolean | null;
      limit?: number | null;
    }): Promise<Reminder[]> =>
      request<Reminder[]>(this.baseUrl, 'GET', '/reminders' + qs({ ...p })),

    create: (input: CreateReminderInput): Promise<Reminder> =>
      request<Reminder>(this.baseUrl, 'POST', '/reminders', input),

    update: (input: UpdateReminderInput): Promise<Reminder> =>
      request<Reminder>(this.baseUrl, 'PUT', `/reminders/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/reminders/${id}`),

    dismiss: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'POST', `/reminders/${id}/dismiss`),
  };

  tags = {
    list: (owner_id: string): Promise<Tag[]> =>
      request<Tag[]>(this.baseUrl, 'GET', '/tags' + qs({ owner_id })),

    create: (input: CreateTagInput): Promise<Tag> =>
      request<Tag>(this.baseUrl, 'POST', '/tags', input),

    update: (input: UpdateTagInput): Promise<Tag> =>
      request<Tag>(this.baseUrl, 'PUT', `/tags/${input.id}`, input),

    delete: (id: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', `/tags/${id}`),
  };

  settings = {
    list: (owner_id: string): Promise<Setting[]> =>
      request<Setting[]>(this.baseUrl, 'GET', '/settings' + qs({ owner_id })),

    upsert: (owner_id: string, key: string, value: string): Promise<Setting> =>
      request<Setting>(this.baseUrl, 'POST', '/settings/upsert', { owner_id, key, value }),

    delete: (owner_id: string, key: string): Promise<void> =>
      request<void>(this.baseUrl, 'DELETE', '/settings' + qs({ owner_id, key })),
  };

  search = {
    query: (
      owner_id: string,
      query: string,
      limit?: number | null,
    ): Promise<SearchResults> =>
      request<SearchResults>(this.baseUrl, 'GET', '/search' + qs({ owner_id, query, limit })),
  };
}
