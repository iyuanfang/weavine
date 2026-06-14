import Link from 'next/link';
import { tagColor } from '@/lib/tag-color';
import { RelationshipBadge } from './relationship-badge';
import { Avatar } from './avatar';

type Props = {
  contact: {
    id: string;
    name: string;
    company: string | null;
    city: string | null;
    avatarUrl?: string | null;
    lastContactedAt: Date | string | null;
    tags: { tag: { id: string; name: string; color: string | null } }[];
  };
  thresholds?: number[];
};

export function ContactCard({ contact, thresholds }: Props) {
  return (
    <li className="card hover:bg-gray-50">
      <Link href={`/contacts/${contact.id}`} className="flex items-center gap-3">
        <Avatar name={contact.name} size={44} src={contact.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{contact.name}</span>
            <RelationshipBadge
              lastContactedAt={contact.lastContactedAt}
              thresholds={thresholds}
              showDot
            />
          </div>
          <div className="text-sm text-gray-500">
            {[contact.company, contact.city].filter(Boolean).join(' · ')}
          </div>
        </div>
        {contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {contact.tags.map((t) => {
              const c = tagColor(t.tag.name);
              return (
                <span
                  key={t.tag.id}
                  className="badge"
                  style={{ background: c.bg, color: c.text }}
                >
                  {t.tag.name}
                </span>
              );
            })}
          </div>
        )}
      </Link>
    </li>
  );
}
