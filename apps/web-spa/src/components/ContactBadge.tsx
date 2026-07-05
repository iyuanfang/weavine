import { Link } from 'react-router-dom';

import { avatarBg } from '../lib/contactColor';
import type { Contact } from '../lib/adapter/types';

interface ContactBadgeProps {
  /** Any contact-like object with at least id + nickname + name. Accepts
   *  the full Contact or narrow subsets loaded for inline display. */
  contact: Pick<Contact, 'id' | 'nickname' | 'name'> | null | undefined;
}

/**
 * Compact clickable badge that shows a contact as a colored avatar-circle +
 * name. Mirrors ProjectBadge's structure (Link + dot-like marker + truncated
 * name + stopPropagation guards) so the two badges sit side-by-side in a row
 * with consistent visual weight.
 *
 * Use inside parent <Link> rows (ActionsList action rows, etc.) — the
 * stopPropagation calls prevent the parent Link from firing when the user
 * clicks the badge.
 */
export function ContactBadge({ contact }: ContactBadgeProps) {
  if (!contact) return null;

  const name = contact.nickname ?? contact.name ?? '?';

  return (
    <Link
      to={`/contacts/${contact.id}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      className="contact-badge"
    >
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
    </Link>
  );
}
