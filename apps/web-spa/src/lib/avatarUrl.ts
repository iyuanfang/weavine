import type { Contact } from './adapter/types';

export interface AvatarUrlOptions {
  baseUrl?: string;
}

export function avatarUrlFor(contact: Pick<Contact, 'avatar_storage_key'>, opts: AvatarUrlOptions = {}): string | null {
  const key = contact.avatar_storage_key;
  if (!key) return null;
  const base = opts.baseUrl ?? '';
  return `${base.replace(/\/+$/, '')}/files/${key}`;
}