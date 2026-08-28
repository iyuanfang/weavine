// ──────────────────────────────────────────────
// Domain types — mirror src-tauri/src/models.rs
// All field names use snake_case to match the Rust
// structs that Tauri commands serialize back to JS.
// ──────────────────────────────────────────────

export interface User {
  id: string;
  name: string | null;
  email: string | null;
  email_verified: string | null;
  image: string | null;
  password_hash: string | null;
  is_local: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Minimal view of the local user — the only thing the
 * frontend needs to identify the current owner. Returned
 * by the `get_local_user` Rust command.
 */
export interface LocalUser {
  id: string;
  name: string | null;
  email: string | null;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  nickname: string;
  name: string | null;
  company: string | null;
  title: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  importance: string;
  last_interaction_at: string;
  keep_in_touch_cadence_days: number | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  avatar_storage_key: string | null;
  avatar_mime: string | null;
  avatar_width: number | null;
  avatar_height: number | null;
  avatar_alt_text: string | null;
}

export interface Event {
  id: string;
  user_id: string;
  title: string;
  // Rust field is `event_type` but serialized as `type` via #[serde(rename)]
  type: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  contact_id: string | null;
  project_id: string | null;
  reminder_lead_minutes: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** LEFT JOIN Contact — only set when contact_id is not null */
  contact_nickname?: string | null;
  /** LEFT JOIN Project — only set when project_id is not null */
  project_title?: string | null;
  /** Multi-participant list (server's entity_links.relation_type='participated') */
  participants?: ParticipantRow[];
}

export interface ParticipantRow {
  contact_id: string;
  role: string;
  nickname?: string | null;
}

export type EntityGraphNodeType = 'contact' | 'project' | 'event' | 'action' | 'note' | 'interaction';

export interface EntityGraphNode {
  id: string;
  entity_type: EntityGraphNodeType;
  label: string;
  subtitle?: string | null;
  is_center?: boolean;
}

export interface EntityGraphEdge {
  from_type: EntityGraphNodeType;
  from_id: string;
  to_type: EntityGraphNodeType;
  to_id: string;
  relation: string;
  label?: string | null;
}

export interface EntityGraphResponse {
  center_type: EntityGraphNodeType;
  center_id: string;
  depth: number;
  nodes: EntityGraphNode[];
  edges: EntityGraphEdge[];
}

export interface Interaction {
  id: string;
  user_id: string;
  contact_id: string | null;
  action_id: string | null;
  event_id: string | null;
  occurred_at: string;
  channel: string | null;
  summary: string;
  /** 'manual' | 'event' | 'todo' — distinguishes auto-logged rows. */
  source?: string;
  source_ref?: string | null;
  created_at: string;
  /** LEFT JOIN Contact — only set when contact_id is not null */
  contact_nickname?: string | null;
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  template: string;
  stage: string;
  start_at: string | null;
  due_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Action {
  id: string;
  user_id: string;
  title: string;
  status: string;
  priority: number;
  category: string | null;
  due_at: string | null;
  contact_id: string | null;
  project_id: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** LEFT JOIN Contact — only set when contact_id is not null */
  contact_nickname?: string | null;
  /** LEFT JOIN Project — only set when project_id is not null */
  project_title?: string | null;
}

export interface Reminder {
  id: string;
  user_id: string;
  contact_id: string | null;
  event_id: string | null;
  trigger_at: string;
  kind: string;
  dispatched: boolean;
  dismissed: boolean;
  invitation_token?: string | null;
  created_at: string;
  /** LEFT JOIN Contact — only set when contact_id is not null */
  contact_nickname?: string | null;
}

export interface Setting {
  id: string;
  user_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyRevealed {
  id: string;
  key: string;
}

export interface CreateApiKeyInput {
  name: string;
}

export interface StartupInfo {
  server_ready: boolean;
  error: string | null;
}

// ──────────────────────────────────────────────
// Query DTOs — match Create*/Update* input structs
// in src-tauri/src/commands/*
// ──────────────────────────────────────────────

export type ContactSortBy = 'last_interaction_at' | 'created_at' | 'nickname';
export type ContactSortDir = 'desc' | 'asc';

export interface ListContactsParams {
  user_id: string;
  tag_id?: string | null;
  search?: string | null;
  importance?: string | null;
  sort_by?: ContactSortBy;
  sort_dir?: ContactSortDir;
  limit?: number;
  cursor?: string | null;
}

export interface ListContactsResult {
  items: Contact[];
  cursor: string | null;
  has_more: boolean;
}

export interface ListNotesResult {
  items: Note[];
  cursor: string | null;
  has_more: boolean;
}

export interface CreateContactInput {
  user_id: string;
  nickname: string;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  wechat?: string | null;
  importance?: string | null;
  tag_ids?: string[] | null;
  /** 0 / undefined = use importance-derived default (high=30, medium=90, low=180). */
  keep_in_touch_cadence_days?: number | null;
}

export interface CreateProjectInput {
  user_id: string;
  title: string;
  template: string;
  stage?: string | null;
  start_at?: string | null;
  due_at?: string | null;
}

export interface UpdateProjectInput {
  id: string;
  title?: string | null;
  stage?: string | null;
  start_at?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  archived_at?: string | null;
}

export interface UpdateContactInput {
  id: string;
  nickname?: string | null;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  wechat?: string | null;
  importance?: string | null;
  tag_ids?: string[] | null;
  /** Sentiment: 0 / undefined = clear override (back to importance default); positive = set cadence override (days). */
  keep_in_touch_cadence_days?: number | null;
}

export interface CreateEventInput {
  user_id: string;
  title: string;
  type: string;
  start_at: string;
  end_at?: string | null;
  location?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  reminder_lead_minutes?: number | null;
  participant_contact_ids?: string[] | null;
}

export interface UpdateEventInput {
  id: string;
  title?: string | null;
  type?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  location?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  reminder_lead_minutes?: number | null;
  archived_at?: string | null;
  participant_contact_ids?: string[] | null;
}

export interface CreateActionInput {
  user_id: string;
  title: string;
  status?: string | null;
  priority?: number | null;
  category?: string | null;
  due_at?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
}

export interface UpdateActionInput {
  id: string;
  title?: string | null;
  status?: string | null;
  priority?: number | null;
  category?: string | null;
  due_at?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  completed_at?: string | null;
  archived_at?: string | null;
}

export interface ProjectContact {
  user_id: string;
  project_id: string;
  contact_id: string;
  role: string | null;
  added_at: string;
}

export interface ProjectContactWithContact {
  contact: Contact;
  role: string | null;
  added_at: string;
}

export interface CreateInteractionInput {
  user_id: string;
  contact_id?: string | null;
  action_id?: string | null;
  event_id?: string | null;
  occurred_at: string;
  channel?: string | null;
  summary: string;
}

export interface UpdateInteractionInput {
  id: string;
  contact_id?: string | null;
  action_id?: string | null;
  event_id?: string | null;
  occurred_at?: string | null;
  channel?: string | null;
  summary?: string | null;
}

export interface CreateReminderInput {
  user_id: string;
  contact_id?: string | null;
  event_id?: string | null;
  trigger_at: string;
  kind?: string | null;
}

export interface UpdateReminderInput {
  id: string;
  trigger_at?: string | null;
  kind?: string | null;
  dispatched?: boolean | null;
  dismissed?: boolean | null;
}

export interface CreateTagInput {
  user_id: string;
  name: string;
}

export interface UpdateTagInput {
  id: string;
  name?: string | null;
}

export interface Note {
  id: string;
  user_id: string;
  title: string;
  body: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  imported_from?: string | null;
  imported_at?: string | null;
}

export interface NoteEntityLink {
  entity_type: 'contact' | 'project' | 'action' | 'event' | 'interaction';
  entity_id: string;
}

export interface CreateNoteInput {
  title: string;
  body: string;
  entity_links?: NoteEntityLink[];
}

export interface UpdateNoteInput {
  id: string;
  title?: string | null;
  body?: string | null;
  entity_links?: NoteEntityLink[] | null;
}

export interface NoteBacklink {
  note_id: string;
  note_title: string;
  snippet: string;
  updated_at: string;
}

export interface MdReadResult {
  content: string;
  encoding: string;
  size_bytes: number;
  mtime_unix_ms: number;
  bom_detected: boolean;
  had_replacement_chars: boolean;
}

export interface MdWriteResult {
  mtime_unix_ms: number;
  size_bytes: number;
}

export interface MdRecentFile {
  path: string;
  last_opened_at: number;
}

export interface MdImportStatus {
  already_imported: boolean;
  note_id: string | null;
  note_title: string | null;
  imported_at: string | null;
  file_mtime_unix_ms: number;
  file_exists: boolean;
  reimport_needed: boolean;
}

export type ConvertSourceFormat =
  | 'md'
  | 'txt'
  | 'docx'
  | 'pdf'
  | 'html'
  | 'xlsx'
  | 'pptx'
  | 'other';

export interface ConvertResult {
  markdown: string;
  source_format: ConvertSourceFormat;
  source_sha1: string;
  source_mtime_unix_ms: number;
  fallback_used: boolean;
  fallback_reason: string | null;
}

export interface ConvertFormatInfo {
  extension: string;
  label: string;
  via_markitdown: boolean;
}

export interface MdImportInput {
  user_id: string;
  path: string;
  title?: string | null;
  body?: string | null;
  mode?: 'create' | 'update' | 'as-new' | 'skip' | null;
  existing_note_id?: string | null;
}

export interface MdImportResult {
  action: 'fast-skip' | 'created' | 'updated' | 'imported-as-new';
  note_id: string;
  note: Note & { imported_from?: string | null; imported_at?: string | null };
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────

export interface SearchResults {
  contacts: Contact[];
  interactions: Interaction[];
  events: Event[];
  actions: Action[];
  projects: Project[];
  notes: Note[];
}

// ──────────────────────────────────────────────
// Adapter contract — every transport must satisfy
// this surface. UI code calls `adapter.contacts.list(...)`
// etc., never `invoke()` directly.
// ──────────────────────────────────────────────

export interface PRMAdapter {
  /** Base URL of the server transport. Empty string means same-origin. */
  baseUrl: string;

  /** Returns the current local user (single-user desktop model). */
  getLocalUser(): Promise<LocalUser>;

  /** Returns server startup status. */
  getStartupInfo(): Promise<StartupInfo>;

  contacts: {
    list(params: ListContactsParams): Promise<ListContactsResult>;
    get(id: string): Promise<Contact>;
    create(input: CreateContactInput): Promise<Contact>;
    update(input: UpdateContactInput): Promise<Contact>;
    delete(id: string): Promise<void>;
  };

  projects: {
    list(params: {
      user_id: string;
      template?: string | null;
      stage?: string | null;
      archived?: 'true' | 'false' | null;
      limit?: number | null;
    }): Promise<Project[]>;
    get(id: string): Promise<Project>;
    create(input: CreateProjectInput): Promise<Project>;
    update(input: UpdateProjectInput): Promise<Project>;
    delete(id: string): Promise<void>;
    stages(template: string): Promise<string[]>;
  };

  events: {
    list(params: {
      user_id: string;
      contact_id?: string | null;
      project_id?: string | null;
      start_after?: string | null;
      start_before?: string | null;
      archived?: 'true' | 'false' | null;
      limit?: number | null;
    }): Promise<Event[]>;
    get(id: string): Promise<Event>;
    create(input: CreateEventInput): Promise<Event>;
    update(input: UpdateEventInput): Promise<Event>;
    delete(id: string): Promise<void>;
    upcoming(user_id: string, limit?: number | null): Promise<Event[]>;
  };

  actions: {
    list(params: {
      user_id: string;
      status?: string | null;
      contact_id?: string | null;
      project_id?: string | null;
      archived?: 'true' | 'false' | null;
      limit?: number | null;
    }): Promise<Action[]>;
    get(id: string): Promise<Action>;
    create(input: CreateActionInput): Promise<Action>;
    update(input: UpdateActionInput): Promise<Action>;
    delete(id: string): Promise<void>;
  };

  projectContacts: {
    list(projectId: string): Promise<ProjectContactWithContact[]>;
    add(projectId: string, contact_id: string, role?: string | null): Promise<void>;
    remove(projectId: string, contact_id: string): Promise<void>;
  };

  interactions: {
    list(params: {
      user_id: string;
      contact_id?: string | null;
      action_id?: string | null;
      event_id?: string | null;
      limit?: number | null;
    }): Promise<Interaction[]>;
    get(id: string): Promise<Interaction>;
    create(input: CreateInteractionInput): Promise<Interaction>;
    update(input: UpdateInteractionInput): Promise<Interaction>;
    delete(id: string): Promise<void>;
  };

  reminders: {
    list(params: {
      user_id: string;
      contact_id?: string | null;
      event_id?: string | null;
      include_dismissed?: boolean | null;
      limit?: number | null;
    }): Promise<Reminder[]>;
    create(input: CreateReminderInput): Promise<Reminder>;
    update(input: UpdateReminderInput): Promise<Reminder>;
    delete(id: string): Promise<void>;
    dismiss(id: string): Promise<void>;
  };

  notifications: {
    /** Show a system-native notification. Returns notification id on string. */
    show: (input: { title: string; body?: string; tag?: string }) => Promise<string>;
    /** Request OS permission to show notifications (mainly Android 13+ / Safari). */
    requestPermission: () => Promise<'granted' | 'denied' | 'default'>;
    /** Current permission state. */
    permission: () => Promise<'granted' | 'denied' | 'default'>;
  };

  graph: {
    get(entity_type: EntityGraphNodeType, entity_id: string): Promise<EntityGraphResponse>;
  };

  tags: {
    list(user_id: string): Promise<Tag[]>;
    create(input: CreateTagInput): Promise<Tag>;
    update(input: UpdateTagInput): Promise<Tag>;
    delete(id: string): Promise<void>;
  };

  notes: {
    list(user_id: string, cursor?: string | null): Promise<ListNotesResult>;
    get(user_id: string, id: string): Promise<Note | null>;
    create(user_id: string, input: CreateNoteInput): Promise<Note>;
    update(user_id: string, id: string, input: UpdateNoteInput): Promise<Note | null>;
    delete(user_id: string, id: string): Promise<boolean>;
    listBacklinks(user_id: string, entity_type: string, entity_id: string): Promise<NoteBacklink[]>;
    listEntityLinks(user_id: string, note_id: string): Promise<NoteEntityLink[]>;
  };

  /** Tauri-only: returns the seeded local user (anonymous install). HttpAdapter throws. */
  getLocalUser(): Promise<LocalUser>;

  md: {
    readFile(path: string): Promise<MdReadResult>;
    writeFile(path: string, content: string, encoding?: string): Promise<MdWriteResult>;
    getFileInfo(path: string): Promise<MdReadResult>;
    openDialog(): Promise<string | null>;
    saveDialog(defaultName?: string | null): Promise<string | null>;
    convertExternalFile(path: string): Promise<ConvertResult>;
    convertSupportedFormats(): Promise<ConvertFormatInfo[]>;
    convertSiblingMdPath(path: string): Promise<string>;
    getRecentFiles(): Promise<MdRecentFile[]>;
    addRecentFile(path: string): Promise<MdRecentFile[]>;
    clearRecentFiles(): Promise<void>;
    checkImportStatus(user_id: string, path: string): Promise<MdImportStatus>;
    importToLibrary(input: MdImportInput): Promise<MdImportResult>;
    exportNoteAsMd(user_id: string, note_id: string, path: string): Promise<MdWriteResult>;
  };

  settings: {
    list(user_id: string): Promise<Setting[]>;
    upsert(user_id: string, key: string, value: string): Promise<Setting>;
    delete(user_id: string, key: string): Promise<void>;
  };

  search: {
    query(
      user_id: string,
      query: string,
      limit?: number | null,
      options?: { include_archived?: boolean | null },
    ): Promise<SearchResults>;
  };

  archive: {
    summary(user_id: string): Promise<ArchiveSummary>;
    counts(user_id: string): Promise<ArchiveCounts>;
    list(user_id: string, entity: 'action' | 'event' | 'project'): Promise<ArchivedItem[]>;
    unarchiveOne(user_id: string, entity: 'action' | 'event' | 'project', id: string): Promise<void>;
    bulkUnarchive(user_id: string, entity: 'action' | 'event' | 'project'): Promise<{ unarchived: number }>;
    sweep(user_id: string): Promise<{ archived: number }>;
  };

  cloud: {
    status(): Promise<CloudStatus>;
    login(input: CloudLoginInput): Promise<CloudStatus>;
    logout(): Promise<void>;
    syncNow(): Promise<CloudSyncResult>;
  };

  apiKeys: {
    list(user_id: string): Promise<ApiKeySummary[]>;
    create(user_id: string, input: CreateApiKeyInput): Promise<ApiKeyRevealed & { name: string; prefix: string; last4: string; created_at: string }>;
    reveal(user_id: string, id: string): Promise<ApiKeyRevealed>;
    revoke(user_id: string, id: string): Promise<void>;
  };

  media: {
    upload(input: UploadMediaInput): Promise<MediaItem>;
    url(id: string): Promise<string>;
    listByOwner(p: ListMediaParams): Promise<MediaItem[]>;
    delete(id: string): Promise<void>;
  };
}

export interface CloudStatus {
  linked: boolean;
  server_url: string | null;
  user_email: string | null;
  last_pulled_revision: number;
  last_pushed_revision: number;
}

export interface CloudLoginInput {
  server_url: string;
  email: string;
  password: string;
}

export interface CloudSyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

export interface ArchiveSummary {
  action_count: number;
  event_count: number;
  project_count: number;
  action_30d: number;
  event_30d: number;
  project_30d: number;
}

export interface ArchiveCounts {
  action: number;
  event: number;
  project: number;
}

export interface ArchivedItem {
  id: string;
  title: string;
  archived_at: string;
}

export interface MediaItem {
  id: string;
  user_id: string;
  kind: string;
  owner_type: string;
  owner_id: string;
  mime: string;
  size_bytes: number;
  sha256: string | null;
  filename: string | null;
  storage_key: string;
  width: number | null;
  height: number | null;
  alt_text: string | null;
}

export type MediaKind = 'avatar' | 'card_image' | 'attachment';
export type MediaOwnerType = 'contact' | 'event' | 'project';

export interface UploadMediaInput {
  kind: MediaKind;
  owner_type: MediaOwnerType;
  owner_id: string;
  bytes: Uint8Array;
  mime: string;
  filename?: string | null;
}

export interface ListMediaParams {
  kind: MediaKind;
  owner_type: MediaOwnerType;
  owner_id: string;
}
