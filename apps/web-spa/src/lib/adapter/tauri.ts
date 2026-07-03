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

import { invoke } from '@tauri-apps/api/core';

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

export class TauriAdapter implements PRMAdapter {
  async getLocalUser(): Promise<LocalUser> {
    return invoke<LocalUser>('get_local_user');
  }

  async getStartupInfo(): Promise<StartupInfo> {
    return invoke<StartupInfo>('get_startup_info');
  }

  contacts = {
    list: (p: {
      owner_id: string;
      tag_id?: string | null;
      search?: string | null;
      importance?: string | null;
    }): Promise<Contact[]> => invoke<Contact[]>('list_contacts', { p }),
    get: (id: string): Promise<Contact> =>
      invoke<Contact>('get_contact', { id }),
    create: (input: CreateContactInput): Promise<Contact> =>
      invoke<Contact>('create_contact', { input }),
    update: (input: UpdateContactInput): Promise<Contact> =>
      invoke<Contact>('update_contact', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_contact', { id }),
  };

  events = {
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      start_after?: string | null;
      start_before?: string | null;
      limit?: number | null;
    }): Promise<Event[]> => invoke<Event[]>('list_events', p),
    get: (id: string): Promise<Event> =>
      invoke<Event>('get_event', { id }),
    create: (input: CreateEventInput): Promise<Event> =>
      invoke<Event>('create_event', { input }),
    update: (input: UpdateEventInput): Promise<Event> =>
      invoke<Event>('update_event', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_event', { id }),
    upcoming: (owner_id: string, limit?: number | null): Promise<Event[]> =>
      invoke<Event[]>('get_upcoming_events', {
        owner_id,
        limit: limit ?? null,
      }),
  };

  actions = {
    list: (p: {
      owner_id: string;
      status?: string | null;
      contact_id?: string | null;
      event_id?: string | null;
      limit?: number | null;
    }): Promise<Action[]> => invoke<Action[]>('list_actions', p),
    get: (id: string): Promise<Action> =>
      invoke<Action>('get_action', { id }),
    create: (input: CreateActionInput): Promise<Action> =>
      invoke<Action>('create_action', { input }),
    update: (input: UpdateActionInput): Promise<Action> =>
      invoke<Action>('update_action', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_action', { id }),
  };

  interactions = {
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      action_id?: string | null;
      event_id?: string | null;
      limit?: number | null;
    }): Promise<Interaction[]> =>
      invoke<Interaction[]>('list_interactions', p),
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
    list: (p: {
      owner_id: string;
      contact_id?: string | null;
      event_id?: string | null;
      include_dismissed?: boolean | null;
      limit?: number | null;
    }): Promise<Reminder[]> => invoke<Reminder[]>('list_reminders', p),
    create: (input: CreateReminderInput): Promise<Reminder> =>
      invoke<Reminder>('create_reminder', { input }),
    update: (input: UpdateReminderInput): Promise<Reminder> =>
      invoke<Reminder>('update_reminder', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_reminder', { id }),
    dismiss: (id: string): Promise<void> =>
      invoke<void>('dismiss_reminder', { id }),
  };

  tags = {
    list: (owner_id: string): Promise<Tag[]> =>
      invoke<Tag[]>('list_tags', { owner_id }),
    create: (input: CreateTagInput): Promise<Tag> =>
      invoke<Tag>('create_tag', { input }),
    update: (input: UpdateTagInput): Promise<Tag> =>
      invoke<Tag>('update_tag', { input }),
    delete: (id: string): Promise<void> =>
      invoke<void>('delete_tag', { id }),
  };

  settings = {
    list: (owner_id: string): Promise<Setting[]> =>
      invoke<Setting[]>('list_settings', { owner_id }),
    upsert: (owner_id: string, key: string, value: string): Promise<Setting> =>
      invoke<Setting>('upsert_setting', { owner_id, key, value }),
    delete: (owner_id: string, key: string): Promise<void> =>
      invoke<void>('delete_setting', { owner_id, key }),
  };

  search = {
    query: (
      owner_id: string,
      query: string,
      limit?: number | null,
    ): Promise<SearchResults> =>
      invoke<SearchResults>('search', { owner_id, query, limit: limit ?? null }),
  };
}

// Feature-detect "are we running inside the Tauri shell?"
// without forcing the rest of the app to import from
// @tauri-apps/api.
export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
