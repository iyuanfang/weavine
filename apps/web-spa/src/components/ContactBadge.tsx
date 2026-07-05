import type { Contact } from '../lib/adapter/types';

type ContactBadgeInput =
  | string
  | (Pick<Contact, 'nickname' | 'name'> & { id?: string })
  | null
  | undefined;

interface ContactBadgeProps {
  contact: ContactBadgeInput;
  compact?: boolean;
}

export function ContactBadge({ contact, compact = false }: ContactBadgeProps) {
  if (!contact) return null;

  const name =
    typeof contact === 'string'
      ? contact.trim()
      : (contact.nickname ?? contact.name ?? '').trim();
  if (!name) return null;

  return (
    <span
      className="contact-badge"
      style={
        compact
          ? { padding: '1px 6px', fontSize: 'var(--text-xs)' }
          : undefined
      }
    >
      <span aria-hidden style={{ flexShrink: 0, fontSize: '0.85em' }}>
        👤
      </span>
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