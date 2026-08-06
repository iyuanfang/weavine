import type { Contact } from '../lib/adapter/types';
import { Avatar } from './Avatar';

type ContactBadgeInput =
  | string
  | (Pick<Contact, 'nickname' | 'name'> & { id?: string; avatar_url?: string | null })
  | null
  | undefined;

interface ContactBadgeProps {
  contact: ContactBadgeInput;
  compact?: boolean;
  avatarUrl?: string | null;
}

export function ContactBadge({ contact, compact = false, avatarUrl }: ContactBadgeProps) {
  if (!contact) return null;

  const name =
    typeof contact === 'string'
      ? contact.trim()
      : (contact.nickname ?? contact.name ?? '').trim();
  if (!name) return null;

  const url =
    avatarUrl ??
    (typeof contact === 'string' ? null : contact.avatar_url ?? null);

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