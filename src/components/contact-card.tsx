import Link from 'next/link';
import { tagColor } from '@/lib/tag-color';
import { RelationshipBadge } from './relationship-badge';
import { Avatar } from './avatar';

type Props = {
  contact: {
    id: string;
    nickname: string;
    name?: string | null;
    company: string | null;
    city: string | null;
    avatarUrl?: string | null;
    lastContactedAt: Date | string | null;
    importance?: string | null;
    tags: { tag: { id: string; name: string; color: string | null } }[];
  };
  thresholds?: number[];
};

const importanceConfig: Record<string, { label: string; className: string }> = {
  important: { label: '重要', className: 'bg-red-50 text-red-600 border-red-200' },
  normal: { label: '普通', className: 'bg-gray-50 text-gray-500 border-gray-200' },
  low: { label: '次要', className: 'bg-gray-50 text-gray-400 border-gray-200' },
};

export function ContactCard({ contact, thresholds }: Props) {
  const display = contact.nickname ?? contact.name ?? '?';
  const imp = contact.importance && importanceConfig[contact.importance]
    ? importanceConfig[contact.importance]
    : null;
  return (
    <li className="card hover:bg-gray-50">
      <Link href={`/contacts/${contact.id}`} className="flex items-center gap-3">
        <Avatar name={display} size={44} src={contact.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{display}</span>
            {contact.name && contact.name !== contact.nickname && (
              <span className="text-xs text-gray-500">({contact.name})</span>
            )}
            {imp && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${imp.className}`}>
                {imp.label}
              </span>
            )}
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
          <div className="flex flex-wrap gap-1 max-w-[35%] sm:max-w-none">
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
