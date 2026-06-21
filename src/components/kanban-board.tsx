'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { transitionAction } from '@/app/actions/actions';
import { ACTION_STATUS_LABEL, type ActionStatus } from '@/lib/action-status';
import { QuickAddAction } from './quick-add-action';
import type { PickerContact } from './contact-picker';

interface KanbanItem {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  priority: number;
  contact: { nickname: string; name: string | null } | null;
}

interface KanbanBoardProps {
  groups: Record<string, KanbanItem[]>;
  contacts: PickerContact[];
}

const COLS: { key: ActionStatus; desc: string; addable: boolean }[] = [
  { key: 'inbox', desc: '刚捕获，待处理', addable: true },
  { key: 'open', desc: '正在推进的工作', addable: true },
  { key: 'waiting', desc: '等待时机/他人/条件满足', addable: true },
  { key: 'done', desc: '最近一周完成', addable: false },
];

export function KanbanBoard({ groups, contacts }: KanbanBoardProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-4">
      {COLS.map((col) => (
        <section
          key={col.key}
          className={`min-h-[40vh] md:min-h-[60vh] rounded border p-3 transition-colors ${
            dragOverCol === col.key
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-200 bg-gray-50'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'move';
            setDragOverCol(col.key);
          }}
          onDragLeave={() => setDragOverCol(null)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOverCol(null);
            const raw = e.dataTransfer!.getData('text/plain');
            if (!raw) return;
            const { id, status } = JSON.parse(raw);
            if (status === col.key) return;
            // Optimistic: move card locally first
            setDraggedId(id);
            try {
              await transitionAction(id, col.key);
              startTransition(() => router.refresh());
            } finally {
              setDraggedId(null);
            }
          }}
        >
          <header className="mb-2">
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>{ACTION_STATUS_LABEL[col.key]}</span>
              <span className="rounded bg-white px-2 text-xs text-gray-500">
                {groups[col.key]?.length ?? 0}
              </span>
            </div>
            <p className="text-xs text-gray-400">{col.desc}</p>
          </header>
          <ul className="space-y-2">
            {(groups[col.key] ?? []).map((a) => {
              const isDragging = a.id === draggedId;
              const isUrgent = a.priority >= 1 || (!!a.dueAt && new Date(a.dueAt) < new Date());
              return (
                <li key={a.id} className={!isDragging ? 'opacity-40' : 'invisible'}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer!.setData('text/plain', JSON.stringify({ id: a.id, status: a.status }));
                      e.dataTransfer!.effectAllowed = 'move';
                    }}
                    className={`card cursor-grab active:cursor-grabbing${isUrgent ? ' border-l-[3px] border-l-red-500 ring-1 ring-inset ring-red-200/70' : ''}`}
                  >
                    <a
                      href={`/actions/${a.id}`}
                      className="block truncate font-semibold text-gray-900 hover:underline"
                    >
                      {a.title}
                    </a>
                    <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                      <span>
                        {a.dueAt
                          ? <span className={isUrgent ? 'font-medium text-red-600' : ''}>{new Date(a.dueAt).toLocaleDateString('zh-CN')}</span>
                          : '无日期'}
                      </span>
                      {a.priority > 0 && (
                        <span className={`rounded px-1 py-0.5 ${isUrgent ? 'border border-red-200 bg-red-50 font-semibold text-red-700' : 'bg-orange-100 font-medium text-orange-700'}`}>
                          P{a.priority}
                        </span>
                      )}
                    </div>
                    {a.contact && (
                      <div className="mt-1 text-xs">
                        <span className="text-accent">→ {a.contact.nickname ?? a.contact.name}</span>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {col.addable && (
            <QuickAddAction status={col.key} contacts={contacts} />
          )}
        </section>
      ))}
    </div>
  );
}
