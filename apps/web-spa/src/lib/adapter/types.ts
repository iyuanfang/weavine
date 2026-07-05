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
  owner_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface Contact {
  id: string;
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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

export interface ListContactsParams {
  owner_id: string;
  tag_id?: string | null;
  search?: string | null;
  importance?: string | null;
}

export interface CreateContactInput {
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
  owner_id: string;
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
    list(params: ListContactsParams): Promise<Contact[]>;
    get(id: string): Promise<Contact>;
    create(input: CreateContactInput): Promise<Contact>;
    update(input: UpdateContactInput): Promise<Contact>;
    delete(id: string): Promise<void>;
  };

  projects: {
    list(params: {
      owner_id: string;
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
      owner_id: string;
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
    upcoming(owner_id: string, limit?: number | null): Promise<Event[]>;
  };

  actions: {
    list(params: {
      owner_id: string;
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
      owner_id: string;
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
      owner_id: string;
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
    list(owner_id: string): Promise<Tag[]>;
    create(input: CreateTagInput): Promise<Tag>;
    update(input: UpdateTagInput): Promise<Tag>;
    delete(id: string): Promise<void>;
  };

  settings: {
    list(owner_id: string): Promise<Setting[]>;
    upsert(owner_id: string, key: string, value: string): Promise<Setting>;
    delete(owner_id: string, key: string): Promise<void>;
  };

  search: {
    query(
      owner_id: string,
      query: string,
      limit?: number | null,
      options?: { include_archived?: boolean | null },
    ): Promise<SearchResults>;
  };

  archive: {
    summary(owner_id: string): Promise<ArchiveSummary>;
    counts(owner_id: string): Promise<ArchiveCounts>;
    list(owner_id: string, entity: 'action' | 'event' | 'project'): Promise<ArchivedItem[]>;
    unarchiveOne(owner_id: string, entity: 'action' | 'event' | 'project', id: string): Promise<void>;
    bulkUnarchive(owner_id: string, entity: 'action' | 'event' | 'project'): Promise<{ unarchived: number }>;
  };
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
