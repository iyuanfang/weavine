import { invoke } from "@tauri-apps/api/core";

export interface Contact {
  id: string;
  ownerId: string;
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
  reminderEnabled: boolean;
  reminderIntervalDays: number | null;
  lastContactedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
}

export interface Tag {
  id: string;
  ownerId: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface Interaction {
  id: string;
  ownerId: string;
  contactId: string | null;
  actionId: string | null;
  eventId: string | null;
  occurredAt: string;
  channel: string | null;
  summary: string;
  createdAt: string;
}

export interface Event {
  id: string;
  ownerId: string;
  title: string;
  type: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  notes: string | null;
  contactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Action {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  category: string | null;
  dueAt: string | null;
  contactId: string | null;
  eventId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  ownerId: string;
  contactId: string | null;
  eventId: string | null;
  triggerAt: string;
  kind: string;
  dispatched: boolean;
  dismissed: boolean;
  createdAt: string;
}

export interface Setting {
  id: string;
  ownerId: string;
  key: string;
  value: string;
  updatedAt: string;
}

export interface SearchResults {
  contacts: Contact[];
  interactions: Interaction[];
  events: Event[];
  actions: Action[];
}

export interface ListContactsParams {
  ownerId: string;
  tagId?: string;
  search?: string;
  importance?: string;
}

export interface CreateContactInput {
  ownerId: string;
  nickname: string;
  name?: string;
  company?: string;
  title?: string;
  city?: string;
  email?: string;
  phone?: string;
  wechat?: string;
  notes?: string;
  importance?: string;
  tagIds?: string[];
}

export interface UpdateContactInput {
  id: string;
  nickname?: string;
  name?: string;
  company?: string;
  title?: string;
  city?: string;
  email?: string;
  phone?: string;
  wechat?: string;
  notes?: string;
  importance?: string;
  tagIds?: string[];
}

export const desktopApi = {
  // Contact
  listContacts: (params: ListContactsParams) =>
    invoke<Contact[]>("list_contacts", { params }),
  getContact: (id: string) => invoke<Contact>("get_contact", { id }),
  createContact: (input: CreateContactInput) =>
    invoke<Contact>("create_contact", { input }),
  updateContact: (input: UpdateContactInput) =>
    invoke<Contact>("update_contact", { input }),
  deleteContact: (id: string) => invoke<void>("delete_contact", { id }),

  // Interaction
  listInteractions: (ownerId: string, contactId?: string, actionId?: string, eventId?: string, limit?: number) =>
    invoke<Interaction[]>("list_interactions", { ownerId, contactId, actionId, eventId, limit }),
  createInteraction: (input: any) => invoke<Interaction>("create_interaction", { input }),
  updateInteraction: (input: any) => invoke<Interaction>("update_interaction", { input }),
  deleteInteraction: (id: string) => invoke<void>("delete_interaction", { id }),

  // Event
  listEvents: (ownerId: string, contactId?: string, startAfter?: string, startBefore?: string, limit?: number) =>
    invoke<Event[]>("list_events", { ownerId, contactId, startAfter, startBefore, limit }),
  getUpcomingEvents: (ownerId: string, limit?: number) =>
    invoke<Event[]>("get_upcoming_events", { ownerId, limit }),
  createEvent: (input: any) => invoke<Event>("create_event", { input }),
  updateEvent: (input: any) => invoke<Event>("update_event", { input }),
  deleteEvent: (id: string) => invoke<void>("delete_event", { id }),

  // Action
  listActions: (ownerId: string, status?: string, contactId?: string, eventId?: string, limit?: number) =>
    invoke<Action[]>("list_actions", { ownerId, status, contactId, eventId, limit }),
  createAction: (input: any) => invoke<Action>("create_action", { input }),
  updateAction: (input: any) => invoke<Action>("update_action", { input }),
  deleteAction: (id: string) => invoke<void>("delete_action", { id }),

  // Reminder
  listReminders: (ownerId: string, contactId?: string, eventId?: string, includeDismissed?: boolean, limit?: number) =>
    invoke<Reminder[]>("list_reminders", { ownerId, contactId, eventId, includeDismissed, limit }),
  createReminder: (input: any) => invoke<Reminder>("create_reminder", { input }),
  updateReminder: (input: any) => invoke<Reminder>("update_reminder", { input }),
  deleteReminder: (id: string) => invoke<void>("delete_reminder", { id }),
  dismissReminder: (id: string) => invoke<void>("dismiss_reminder", { id }),

  // Tag
  listTags: (ownerId: string) => invoke<Tag[]>("list_tags", { ownerId }),
  createTag: (input: { ownerId: string; name: string; color?: string }) =>
    invoke<Tag>("create_tag", { input }),
  updateTag: (input: { id: string; name?: string; color?: string }) =>
    invoke<Tag>("update_tag", { input }),
  deleteTag: (id: string) => invoke<void>("delete_tag", { id }),

  // Setting
  listSettings: (ownerId: string) => invoke<Setting[]>("list_settings", { ownerId }),
  upsertSetting: (ownerId: string, key: string, value: string) =>
    invoke<Setting>("upsert_setting", { ownerId, key, value }),
  deleteSetting: (ownerId: string, key: string) =>
    invoke<void>("delete_setting", { ownerId, key }),

  // Search
  search: (ownerId: string, query: string, limit?: number) =>
    invoke<SearchResults>("search", { ownerId, query, limit }),
};
