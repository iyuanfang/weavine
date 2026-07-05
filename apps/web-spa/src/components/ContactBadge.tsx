import { avatarBg } from '../lib/contactColor';
import type { Contact } from '../lib/adapter/types';

interface ContactBadgeProps {
  /** Any contact-like object with at least id + nickname + name. Accepts
   *  the full Contact or narrow subsets loaded for inline display. */
  contact: Pick<Contact, 'id' | 'nickname' | 'name'> | null | undefined;
}

export function ContactBadge({ contact }: ContactBadgeProps) {
  if (!contact) return null;

  const name = contact.nickname ?? contact.name ?? '?';

  return (
    <span className="contact-badge">
      <span
        aria-hidden
        className="contact-badge__marker"
        style={{ background: avatarBg(name) }}
      />
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