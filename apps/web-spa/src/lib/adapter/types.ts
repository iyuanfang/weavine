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
  city: string | null;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  notes: string | null;
  importance: string;
  reminder_enabled: boolean;
  reminder_interval_days: number | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
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
  notes: string | null;
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
  created_at: string;
  /** LEFT JOIN Contact — only set when contact_id is not null */
  contact_nickname?: string | null;
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
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
  description: string | null;
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

export interface StartupInfo {
  server_ready: boolean;
  error: string | null;
}

// ──────────────────────────────────────────────
// Query DTOs — match Create*/Update* input structs
// in src-tauri/src/commands/*
// ──────────────────────────────────────────────

export type ContactSortBy = 'last_contacted_at' | 'created_at' | 'nickname';
export type ContactSortDir = 'desc' | 'asc';

export interface ListContactsParams {
  user_id: string;
  tag_id?: string | null;
  search?: string | null;
  importance?: string | null;
  sort_by?: ContactSortBy;
  sort_dir?: ContactSortDir;
  limit?: number;
  offset?: number;
}

export interface ListContactsResult {
  items: Contact[];
  total: number;
}

export interface CreateContactInput {
  user_id: string;
  nickname: string;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  wechat?: string | null;
  notes?: string | null;
  importance?: string | null;
  tag_ids?: string[] | null;
}

export interface CreateProjectInput {
  user_id: string;
  title: string;
  description?: string | null;
  template: string;
  stage?: string | null;
  start_at?: string | null;
  due_at?: string | null;
}

export interface UpdateProjectInput {
  id: string;
  title?: string | null;
  description?: string | null;
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
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  wechat?: string | null;
  notes?: string | null;
  importance?: string | null;
  tag_ids?: string[] | null;
}

export interface CreateEventInput {
  user_id: string;
  title: string;
  type: string;
  start_at: string;
  end_at?: string | null;
  location?: string | null;
  notes?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  reminder_lead_minutes?: number | null;
}

export interface UpdateEventInput {
  id: string;
  title?: string | null;
  type?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  location?: string | null;
  notes?: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  reminder_lead_minutes?: number | null;
  archived_at?: string | null;
}

export interface CreateActionInput {
  user_id: string;
  title: string;
  description?: string | null;
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
  description?: string | null;
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

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────

export interface SearchResults {
  contacts: Contact[];
  interactions: Interaction[];
  events: Event[];
  actions: Action[];
  projects: Project[];
}

// ──────────────────────────────────────────────
// Adapter contract — every transport must satisfy
// this surface. UI code calls `adapter.contacts.list(...)`
// etc., never `invoke()` directly.
// ──────────────────────────────────────────────

export interface PRMAdapter {
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

  tags: {
    list(user_id: string): Promise<Tag[]>;
    create(input: CreateTagInput): Promise<Tag>;
    update(input: UpdateTagInput): Promise<Tag>;
    delete(id: string): Promise<void>;
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
