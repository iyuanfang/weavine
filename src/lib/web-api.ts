// Web (Next.js) API layer
// In Phase 1, web mode is being phased out — local-first desktop is the primary target.
// These stub methods allow the existing Next.js pages to keep working without dataAccess refactor.

import type {
  Contact,
  Event,
  Interaction,
  Action,
  Reminder,
  Tag,
  Setting,
  SearchResults,
  ListContactsParams,
  CreateContactInput,
  UpdateContactInput,
} from "./desktop-api";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

export const webApi = {
  // Contact
  listContacts: (_params: ListContactsParams) =>
    get<Contact[]>("/api/contacts"),
  getContact: (id: string) => get<Contact>(`/api/contacts/${id}`),
  createContact: (input: CreateContactInput) =>
    post<Contact>("/api/contacts", input),
  updateContact: (input: UpdateContactInput) =>
    post<Contact>(`/api/contacts/${input.id}`, { ...input, _method: "PATCH" }),
  deleteContact: async (id: string) => {
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
  },

  // Interaction
  listInteractions: (_ownerId: string, contactId?: string) =>
    contactId
      ? get<Interaction[]>(`/api/contacts/${contactId}/interactions`)
      : Promise.resolve([] as Interaction[]),
  createInteraction: (input: any) =>
    post<Interaction>("/api/interactions", input),
  updateInteraction: (input: any) =>
    post<Interaction>(`/api/interactions/${input.id}`, input),
  deleteInteraction: async (id: string) => {
    await fetch(`/api/interactions/${id}`, { method: "DELETE" });
  },

  // Event
  listEvents: (_ownerId: string) => get<Event[]>("/api/events"),
  getUpcomingEvents: (_ownerId: string) =>
    get<Event[]>("/api/events?filter=upcoming"),
  createEvent: (input: any) => post<Event>("/api/events", input),
  updateEvent: (input: any) =>
    post<Event>(`/api/events/${input.id}`, input),
  deleteEvent: async (id: string) => {
    await fetch(`/api/events/${id}`, { method: "DELETE" });
  },

  // Action
  listActions: (_ownerId: string, status?: string) =>
    get<Action[]>(`/api/actions${status ? `?status=${status}` : ""}`),
  createAction: (input: any) => post<Action>("/api/actions", input),
  updateAction: (input: any) =>
    post<Action>(`/api/actions/${input.id}`, input),
  deleteAction: async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: "DELETE" });
  },

  // Reminder
  listReminders: (_ownerId: string) => get<Reminder[]>("/api/reminders"),
  createReminder: (input: any) => post<Reminder>("/api/reminders", input),
  updateReminder: (input: any) =>
    post<Reminder>(`/api/reminders/${input.id}`, input),
  deleteReminder: async (id: string) => {
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
  },
  dismissReminder: async (id: string) => {
    await fetch(`/api/reminders/${id}/dismiss`, { method: "POST" });
  },

  // Tag
  listTags: (_ownerId: string) => get<Tag[]>("/api/tags"),
  createTag: (input: { ownerId: string; name: string; color?: string }) =>
    post<Tag>("/api/tags", input),
  updateTag: (input: { id: string; name?: string; color?: string }) =>
    post<Tag>(`/api/tags/${input.id}`, input),
  deleteTag: async (id: string) => {
    await fetch(`/api/tags/${id}`, { method: "DELETE" });
  },

  // Setting
  listSettings: (_ownerId: string) => get<Setting[]>("/api/settings"),
  upsertSetting: (ownerId: string, key: string, value: string) =>
    post<Setting>("/api/settings", { ownerId, key, value }),
  deleteSetting: async (ownerId: string, key: string) => {
    await fetch(`/api/settings?ownerId=${ownerId}&key=${key}`, {
      method: "DELETE",
    });
  },

  // Search
  search: (_ownerId: string, query: string) =>
    get<SearchResults>(`/api/search?q=${encodeURIComponent(query)}`),
};
