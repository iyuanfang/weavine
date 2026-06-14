import Link from 'next/link';
import { tagColor } from '@/lib/tag-color';

type Props = {
  contact: {
    id: string;
    name: string;
    company: string | null;
    city: string | null;
    tags: { tag: { id: string; name: string; color: string | null } }[];
  };
};

export function ContactCard({ contact }: Props) {
  return (
    <li className="rounded border p-3 hover:bg-gray-50">
      <Link href={`/contacts/${contact.id}`} className="block">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{contact.name}</div>
            <div className="text-sm text-gray-500">
              {[contact.company, contact.city].filter(Boolean).join(' · ')}
            </div>
          </div>
          {contact.tags.length > 0 && (
            <div className="flex gap-1">
              {contact.tags.map((t) => (
                  <span
                    key={t.tag.id}
                    className="rounded px-2.5 py-1 text-xs font-medium"
                    style={{ background: tagColor(t.tag.name).bg, color: tagColor(t.tag.name).text }}
                  >
                    {t.tag.name}
                  </span>
              ))}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
