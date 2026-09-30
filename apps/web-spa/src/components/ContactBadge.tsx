import { useAdapter } from '../lib/adapter';
import type { Contact } from '../lib/adapter/types';
import { avatarUrlFor } from '../lib/avatarUrl';
import { Avatar } from './Avatar';

type ContactBadgeInput =
  | string
  | (Pick<Contact, 'nickname' | 'name'> & {
      id?: string;
      avatar_storage_key?: string | null;
      avatar_mime?: string | null;
    })
  | null
  | undefined;

interface ContactBadgeProps {
  contact: ContactBadgeInput;
  compact?: boolean;
  avatarUrl?: string | null;
}

export function ContactBadge({ contact, compact = false, avatarUrl }: ContactBadgeProps) {
  const adapter = useAdapter();
  if (!contact) return null;

  const name =
    typeof contact === 'string'
      ? contact.trim()
      : (contact.nickname ?? contact.name ?? '').trim();
  if (!name) return null;

  let computedUrl: string | null;
  if (typeof contact === 'string') {
    computedUrl = null;
  } else if (contact.avatar_storage_key) {
    computedUrl = avatarUrlFor(
      {
        avatar_storage_key: contact.avatar_storage_key,
        avatar_mime: contact.avatar_mime ?? null,
      } as Contact,
      { baseUrl: adapter.baseUrl },
    );
  } else {
    computedUrl = null;
  }
  const url = avatarUrl ?? computedUrl;

  return (
    <span
      className="contact-badge"
      style={
        compact
          ? { padding: '1px 6px', fontSize: 'var(--text-xs)' }
          : undefined
      }
    >
      <Avatar name={name} src={url} size={compact ? 18 : 22} />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {name}
      </span>
    </span>
  );
}