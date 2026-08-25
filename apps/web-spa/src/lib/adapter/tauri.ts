// TauriAdapter — wraps `invoke()` calls with the exact
// snake_case payload shape each Rust command expects.
// Field names here match the Rust parameter names 1:1.
//
// IMPORTANT: Tauri v2's `#[tauri::command]` macro defaults to
// `rename_all = "camelCase"`, which would auto-convert our
// snake_case keys on the JS-to-Rust boundary and break every
// flat-arg command. Each affected Rust command therefore
// declares `#[tauri::command(rename_all = "snake_case")]` to
// preserve the 1:1 mapping this adapter relies on. See the
// Rust `commands/*.rs` files and commit c61d64a for details.
//
// Desktop auth model (see auth/index.ts:1-6):
//   There is no login flow. Rust seeds a `User` row on boot
//   (`isLocal=1`) and `get_local_user` returns it. Every data
//   command takes `user_id` at the wire boundary — the JS
//   adapter supplies it transparently from the cached local
//   user. The HTTP server adapter also uses `user_id` now;
//   the two stacks are aligned on `user_id` end-to-end.

import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

import type {
  Action,
  ApiKeyRevealed,
  ApiKeySummary,
  ArchivedItem,
  ArchiveCounts,
  ArchiveSummary,
  CloudLoginInput,
  CloudStatus,
  CloudSyncResult,
  Contact,
  CreateActionInput,
  CreateContactInput,
  CreateEventInput,
  CreateNoteInput,
  CreateInteractionInput,
  CreateProjectInput,
  CreateReminderInput,
  CreateTagInput,
  EntityGraphNodeType,
  EntityGraphResponse,
  Event,
  Interaction,
  ListContactsResult,
  ListNotesResult,
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
  UpdateInteractionInput,
  UpdateNoteInput,
  UpdateProjectInput,
  UpdateReminderInput,
  UpdateTagInput,
  UploadMediaInput,
} from './types';

type UserIdPayload = { user_id?: string | null; [k: string]: unknown };

// Tauri v2 serves custom URI scheme protocols from different origins per platform:
//   macOS/Linux (WKWebView/webkitgtk): files://localhost/<path>
//   Windows (WebView2) & Android (WebView): http://files.localhost/<path>
// The Rust handler is registered in src-tauri/src/lib.rs (register_uri_scheme_protocol("files"))
// and expects the "/files/<key>" path prefix on every platform.
function filesBaseUrl(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Android|Windows/i.test(ua)) return 'http://files.localhost';
  return 'files://localhost';
}

export class TauriAdapter implements PRMAdapter {
  baseUrl = filesBaseUrl();
  private userIdReady: Promise<string>;

  constructor() {
    this.userIdReady = invoke<LocalUser>('get_local_user')
      .then((u) => (u?.id ? u.id : null))
      .catch(() => null)
      .then((id) => {
        if (id) return id;
        return invoke<string>('get_install_id').catch((err) => {
          throw new Error(
            `TauriAdapter: failed to resolve user_id (no local user and get_install_id failed): ${String(err)}`,
          );
        });
      });
  }

  private async withUserId(
    payload: UserIdPayload = {},
  ): Promise<Record<string, unknown>> {
    const user_id = await this.userIdReady;
    return { user_id, ...payload };
  }

  async getLocalUser(): Promise<LocalUser> {
    return invoke<LocalUser>('get_local_user');
  }

  async getStartupInfo(): Promise<StartupInfo> {
    return invoke<StartupInfo>('get_startup_info');
  }

  contacts = {
    list: async (p: {
      user_id: string;
      tag_id?: string | null;
      search?: string | null;
      importance?: string | null;
      sort_by?: string;
      sort_dir?: string;
      limit?: number;
      cursor?: string | null;
    }): Promise<ListContactsResult> => {
      const inner = await this.withUserId(p);
      const paramsWithDefaults = {
        sort_by: 'last_interaction_at',
        limit: 20,
        cursor: null,
        ...inner,
      };
      const [items, has_more] = await invoke<[Contact[], boolean]>('list_contacts', { p: paramsWithDefaults });
      const cursor = items.length > 0 ? `${items[items.length - 1].updated_at},${items[items.length - 1].id}` : null;
      return { items, cursor, has_more };
    },
    get: (id: string): Promise<Contact> =>
      invoke<Contact>('get_contact', { id }),
    create: (input: CreateContactInput): Promise<Contact> =>
      invoke<Contact>('create_contact', { input }),
    update: (input: UpdateContactInput): Promise<Contact> =>
      invoke<Contact>('update_contact', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_contact', { id }),
  };

  projects = {
    list: async (p: {
      user_id: string;
      template?: string | null;
      stage?: string | null;
      limit?: number | null;
    }): Promise<Project[]> => {
      const inner = await this.withUserId(p);
      return invoke<Project[]>('list_projects', { params: inner });
    },
    get: (id: string): Promise<Project> =>
      invoke<Project>('get_project', { id }),
    create: (input: CreateProjectInput): Promise<Project> =>
      invoke<Project>('create_project', { input }),
    update: (input: UpdateProjectInput): Promise<Project> =>
      invoke<Project>('update_project', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_project', { id }),
    stages: (template: string): Promise<string[]> =>
      invoke<string[]>('list_project_stages', { template }),
  };

  events = {
    list: async (p: {
      user_id: string;
      contact_id?: string | null;
      project_id?: string | null;
      start_after?: string | null;
      start_before?: string | null;
      limit?: number | null;
    }): Promise<Event[]> => {
      const flat = await this.withUserId(p);
      return invoke<Event[]>('list_events', flat);
    },
    get: (id: string): Promise<Event> =>
      invoke<Event>('get_event', { id }),
    create: (input: CreateEventInput): Promise<Event> =>
      invoke<Event>('create_event', { input }),
    update: (input: UpdateEventInput): Promise<Event> =>
      invoke<Event>('update_event', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_event', { id }),
    upcoming: async (
      _user_id: string,
      limit?: number | null,
    ): Promise<Event[]> => {
      const user_id = await this.userIdReady;
      return invoke<Event[]>('get_upcoming_events', {
        user_id,
        limit: limit ?? null,
      });
    },
  };

  actions = {
    list: async (p: {
      user_id: string;
      status?: string | null;
      contact_id?: string | null;
      project_id?: string | null;
      limit?: number | null;
    }): Promise<Action[]> => {
      const flat = await this.withUserId(p);
      return invoke<Action[]>('list_actions', flat);
    },
    get: (id: string): Promise<Action> =>
      invoke<Action>('get_action', { id }),
    create: (input: CreateActionInput): Promise<Action> =>
      invoke<Action>('create_action', { input }),
    update: (input: UpdateActionInput): Promise<Action> =>
      invoke<Action>('update_action', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_action', { id }),
  };

  projectContacts = {
    list: (project_id: string): Promise<ProjectContactWithContact[]> =>
      invoke<ProjectContactWithContact[]>('list_project_contacts', {
        project_id,
      }),
    add: (
      project_id: string,
      contact_id: string,
      role?: string | null,
    ): Promise<void> =>
      invoke<void>('add_project_contact', {
        input: { project_id, contact_id, role: role ?? null },
      }),
    remove: (project_id: string, contact_id: string): Promise<void> =>
      invoke<void>('remove_project_contact', { project_id, contact_id }),
  };

  interactions = {
    list: async (p: {
      user_id: string;
      contact_id?: string | null;
      action_id?: string | null;
      event_id?: string | null;
      limit?: number | null;
    }): Promise<Interaction[]> => {
      const flat = await this.withUserId(p);
      return invoke<Interaction[]>('list_interactions', flat);
    },
    get: (id: string): Promise<Interaction> =>
      invoke<Interaction>('get_interaction', { id }),
    create: (input: CreateInteractionInput): Promise<Interaction> =>
      invoke<Interaction>('create_interaction', { input }),
    update: (input: UpdateInteractionInput): Promise<Interaction> =>
      invoke<Interaction>('update_interaction', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_interaction', { id }),
  };

  reminders = {
    list: async (p: {
      user_id: string;
      contact_id?: string | null;
      event_id?: string | null;
      include_dismissed?: boolean | null;
      limit?: number | null;
    }): Promise<Reminder[]> => {
      const flat = await this.withUserId(p);
      return invoke<Reminder[]>('list_reminders', flat);
    },
    create: (input: CreateReminderInput): Promise<Reminder> =>
      invoke<Reminder>('create_reminder', { input }),
    update: (input: UpdateReminderInput): Promise<Reminder> =>
      invoke<Reminder>('update_reminder', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_reminder', { id }),
    dismiss: (id: string): Promise<void> =>
      invoke<void>('dismiss_reminder', { id }),
  };

  notifications = {
    show: async (input: { title: string; body?: string; tag?: string }) => {
      const { title, body, tag } = input;
      sendNotification({ title, body, ...(tag ? { tag } : {}) });
      return tag ?? `tnotif-${Date.now()}`;
    },
    requestPermission: async () => {
      const perm = await requestPermission();
      return perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'default';
    },
    permission: async () => {
      const perm = await isPermissionGranted();
      return perm ? 'granted' : 'default';
    },
  };

  tags = {
    list: async (_user_id: string): Promise<Tag[]> => {
      const user_id = await this.userIdReady;
      return invoke<Tag[]>('list_tags', { user_id });
    },
    create: (input: CreateTagInput): Promise<Tag> =>
      invoke<Tag>('create_tag', { input }),
    update: (input: UpdateTagInput): Promise<Tag> =>
      invoke<Tag>('update_tag', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_tag', { id }),
  };

  notes = {
    list: async (user_id: string, cursor?: string | null): Promise<ListNotesResult> => {
      const [items, has_more] = await invoke<[Note[], boolean]>('list_notes', { user_id, cursor: cursor ?? null });
      const cursorOut = items.length > 0 ? `${items[items.length - 1].updated_at},${items[items.length - 1].id}` : null;
      return { items, cursor: cursorOut, has_more };
    },
    get: async (user_id: string, id: string): Promise<Note | null> =>
      invoke<Note | null>('get_note', { user_id, id }),
    create: async (user_id: string, input: CreateNoteInput): Promise<Note> =>
      invoke<Note>('create_note', { user_id, input }),
    update: async (
      user_id: string,
      id: string,
      input: UpdateNoteInput,
    ): Promise<Note | null> =>
      invoke<Note | null>('update_note', { user_id, id, input }),
    delete: async (user_id: string, id: string): Promise<boolean> =>
      invoke<boolean>('delete_note', { user_id, id }),
    listBacklinks: async (
      user_id: string,
      entity_type: string,
      entity_id: string,
    ): Promise<NoteBacklink[]> =>
      invoke<NoteBacklink[]>('list_note_backlinks', { user_id, entity_type, entity_id }),
    listEntityLinks: async (user_id: string, note_id: string): Promise<NoteEntityLink[]> =>
      invoke<NoteEntityLink[]>('list_note_entities', { user_id, note_id }),
  };

  settings = {
    list: async (_user_id: string): Promise<Setting[]> => {
      const user_id = await this.userIdReady;
      return invoke<Setting[]>('list_settings', { user_id });
    },
    upsert: async (
      _user_id: string,
      key: string,
      value: string,
    ): Promise<Setting> => {
      const user_id = await this.userIdReady;
      return invoke<Setting>('upsert_setting', { user_id, key, value });
    },
    delete: async (_user_id: string, key: string): Promise<void> => {
      const user_id = await this.userIdReady;
      return invoke<void>('delete_setting', { user_id, key });
    },
  };

  search = {
    query: async (
      _user_id: string,
      query: string,
      limit?: number | null,
      options?: { include_archived?: boolean | null },
    ): Promise<SearchResults> => {
      const user_id = await this.userIdReady;
      return invoke<SearchResults>('search', {
        user_id,
        query,
        limit: limit ?? null,
        include_archived: options?.include_archived ?? true,
      });
    },
  };

  archive = {
    summary: async (_user_id: string): Promise<ArchiveSummary> => {
      const user_id = await this.userIdReady;
      return invoke<ArchiveSummary>('archive_summary', { user_id });
    },
    counts: async (_user_id: string): Promise<ArchiveCounts> => {
      const user_id = await this.userIdReady;
      return invoke<ArchiveCounts>('archive_counts', { user_id });
    },
    list: async (
      _user_id: string,
      entity: 'action' | 'event' | 'project',
    ): Promise<ArchivedItem[]> => {
      const user_id = await this.userIdReady;
      return invoke<ArchivedItem[]>('list_archive', { user_id, entity });
    },
    unarchiveOne: async (
      _user_id: string,
      entity: 'action' | 'event' | 'project',
      id: string,
    ): Promise<void> => {
      const user_id = await this.userIdReady;
      return invoke<void>('unarchive_one', { user_id, entity, id });
    },
    bulkUnarchive: async (
      _user_id: string,
      entity: 'action' | 'event' | 'project',
    ): Promise<{ unarchived: number }> => {
      const user_id = await this.userIdReady;
      return invoke<{ unarchived: number }>('bulk_unarchive', {
        user_id,
        entity,
      });
    },
    sweep: async (_user_id: string): Promise<{ archived: number }> => {
      const user_id = await this.userIdReady;
      return invoke<{ archived: number }>('archive_sweep', { user_id });
    },
  };

  cloud = {
    status: (): Promise<CloudStatus> => invoke<CloudStatus>('cloud_status'),
    login: (input: CloudLoginInput): Promise<CloudStatus> =>
      invoke<CloudStatus>('cloud_login', {
        server_url: input.server_url,
        email: input.email,
        password: input.password,
      }),
    logout: (): Promise<void> => invoke<void>('cloud_logout'),
    syncNow: (): Promise<CloudSyncResult> =>
      invoke<CloudSyncResult>('cloud_sync_now'),
  };

  apiKeys = {
    list: (): Promise<ApiKeySummary[]> =>
      Promise.reject(new Error('api_keys are cloud-only — sign in via the cloud path')),
    create: (): Promise<ApiKeyRevealed & { name: string; prefix: string; last4: string; created_at: string }> =>
      Promise.reject(new Error('api_keys are cloud-only — sign in via the cloud path')),
    reveal: (): Promise<ApiKeyRevealed> =>
      Promise.reject(new Error('api_keys are cloud-only — sign in via the cloud path')),
    revoke: (): Promise<void> =>
      Promise.reject(new Error('api_keys are cloud-only — sign in via the cloud path')),
  };

  graph = {
    get: async (entity_type: EntityGraphNodeType, entity_id: string): Promise<EntityGraphResponse> => {
      const payload = await this.withUserId({ entity_type, entity_id });
      return invoke<EntityGraphResponse>('entity_graph', payload);
    },
  };

  media = {
    upload: async (input: UploadMediaInput): Promise<MediaItem> => {
      if (input.owner_type === 'contact' && input.kind === 'avatar') {
        const user_id = await this.userIdReady;
        const bytes = input.bytes;
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const data_url = `data:${input.mime};base64,${btoa(bin)}`;
        const res = await invoke<{ media: MediaItem; data_url: string }>('upload_avatar', {
          user_id,
          contact_id: input.owner_id,
          data_url,
        });
        return res.media;
      }
      if (input.owner_type === 'contact' && input.kind === 'card_image') {
        const bytes = input.bytes;
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const data_url = `data:${input.mime};base64,${btoa(bin)}`;
        const res = await invoke<{ media: MediaItem }>('save_card_image', {
          contact_id: input.owner_id,
          image_base64: data_url.split(',')[1] ?? data_url,
        });
        return res.media;
      }
      throw new Error(`media kind '${input.kind}' / owner '${input.owner_type}' is not supported on desktop`);
    },

    getBlobDataUrl: async (id: string): Promise<string> => {
      const url = await invoke<string | null>('get_media_data_url', { media_id: id });
      if (!url) throw new Error(`media ${id} not found`);
      return url;
    },

    url: async (id: string): Promise<string> => {
      const url = await invoke<string | null>('get_media_data_url', { media_id: id });
      if (!url) throw new Error(`media ${id} not found`);
      return url;
    },

    listByOwner: async (p: ListMediaParams): Promise<MediaItem[]> => {
      const user_id = await this.userIdReady;
      return invoke<MediaItem[]>('list_media_by_owner', {
        user_id,
        kind: p.kind,
        owner_type: p.owner_type,
        owner_id: p.owner_id,
      });
    },

    delete: async (id: string): Promise<void> => {
      await invoke<void>('delete_media', { media_id: id });
    },
  };
}

// Feature-detect "are we running inside the Tauri shell?"
// without forcing the rest of the app to import from
// @tauri-apps/api.
export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;