"use client";

import { isTauri } from "./env";
import { desktopApi } from "./desktop-api";
import { webApi } from "./web-api";

const api = isTauri() ? desktopApi : webApi;

export const dataAccess = api;

export type {
  Contact,
  Tag,
  Interaction,
  Event,
  Action,
  Reminder,
  Setting,
  SearchResults,
  ListContactsParams,
  CreateContactInput,
  UpdateContactInput,
} from "./desktop-api";
