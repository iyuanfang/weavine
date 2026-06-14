'use client';

import Link from 'next/link';
import { moveNeed } from '@/app/needs/actions';

type NeedItem = {
  id: string;
  title: string;
  category: string;
  contact: { id: string; name: string } | null;
};

const COLS = [
  { key: 'open', label: '待办' },
  { key: 'matched', label: '已匹配' },
  { key: 'in_progress', label: '进行中' },
  { key: 'closed', label: '已关闭' },
] as const;

export function Kanban({ groups }: { groups: Record<string, NeedItem[]> }) {
  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  }

  async function onDrop(e: React.DragEvent, to: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) {
      await moveNeed(id, to);
    }
  }

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-4">
      {COLS.map((col) => (
        <section
          key={col.key}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e, col.key)}
          className="min-h-[60vh] rounded border bg-gray-50 p-3"
        >
          <header className="mb-2 flex items-center justify-between text-sm font-semibold">
            <span>{col.label}</span>
            <span className="rounded bg-white px-2 text-xs text-gray-500">
              {groups[col.key]?.length ?? 0}
            </span>
          </header>
          <ul className="space-y-2">
            {(groups[col.key] ?? []).map((n) => (
              <li
                key={n.id}
                draggable
                onDragStart={(e) => onDragStart(e, n.id)}
                className="cursor-move rounded border bg-white p-2 text-sm shadow-sm"
              >
                <Link className="font-medium text-accent" href={`/needs/${n.id}`}>
                  {n.title}
                </Link>
                <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                  <span>{n.category}</span>
                  {n.contact && <span>→ {n.contact.name}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
