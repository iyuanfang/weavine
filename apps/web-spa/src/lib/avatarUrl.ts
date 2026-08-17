import type { Contact } from './adapter/types';

export interface AvatarUrlOptions {
  baseUrl?: string;
}

export function avatarUrlFor(contact: Pick<Contact, 'avatar_storage_key'>, opts: AvatarUrlOptions = {}): string | null {
  const key = contact.avatar_storage_key;
  if (!key) return null;
  const base = opts.baseUrl ?? '';
  const v = hashKey(key);
  return `${base.replace(/\/+$/, '')}/files/${key}?v=${v}`;
}

function hashKey(k: string): string {
  let h = 0;
  for (let i = 0; i < k.length; i++) h = ((h << 5) - h + k.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}