// HttpAdapter — stub implementation for the web/browser build.
// Mirrors the PRMAdapter surface so call sites can swap
// `new HttpAdapter(baseUrl)` for `new TauriAdapter()` without
// touching component code. Every method rejects with a clear
// "unimplemented" error so the UI shows a real failure
// instead of hanging on a network request that will never
// arrive (the HTTP transport is Phase 2 work).

import type { PRMAdapter } from './types';

function unimplemented(method: string): Promise<never> {
  return Promise.reject(
    new Error(
      `HttpAdapter.${method}: HTTP transport not yet implemented (Phase 2)`,
    ),
  );
}

export class HttpAdapter implements Partial<PRMAdapter> {
  constructor(public baseUrl: string) {
    // baseUrl is reserved for Phase 2 — once we add a real
    // REST gateway, the constructor will stash it for fetch().
    void baseUrl;
  }

  getLocalUser = () => unimplemented('getLocalUser');

  contacts = {
    list: () => unimplemented('contacts.list'),
    get: () => unimplemented('contacts.get'),
    create: () => unimplemented('contacts.create'),
    update: () => unimplemented('contacts.update'),
    delete: () => unimplemented('contacts.delete'),
  };

  events = {
    list: () => unimplemented('events.list'),
    get: () => unimplemented('events.get'),
    create: () => unimplemented('events.create'),
    update: () => unimplemented('events.update'),
    delete: () => unimplemented('events.delete'),
    upcoming: () => unimplemented('events.upcoming'),
  };

  actions = {
    list: () => unimplemented('actions.list'),
    get: () => unimplemented('actions.get'),
    create: () => unimplemented('actions.create'),
    update: () => unimplemented('actions.update'),
    delete: () => unimplemented('actions.delete'),
  };

  interactions = {
    list: () => unimplemented('interactions.list'),
    get: () => unimplemented('interactions.get'),
    create: () => unimplemented('interactions.create'),
    update: () => unimplemented('interactions.update'),
    delete: () => unimplemented('interactions.delete'),
  };

  reminders = {
    list: () => unimplemented('reminders.list'),
    create: () => unimplemented('reminders.create'),
    update: () => unimplemented('reminders.update'),
    delete: () => unimplemented('reminders.delete'),
    dismiss: () => unimplemented('reminders.dismiss'),
  };

  tags = {
    list: () => unimplemented('tags.list'),
    create: () => unimplemented('tags.create'),
    update: () => unimplemented('tags.update'),
    delete: () => unimplemented('tags.delete'),
  };

  settings = {
    list: () => unimplemented('settings.list'),
    upsert: () => unimplemented('settings.upsert'),
    delete: () => unimplemented('settings.delete'),
  };

  search = {
    query: () => unimplemented('search.query'),
  };
}
