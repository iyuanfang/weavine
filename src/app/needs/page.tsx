import Link from 'next/link';
import { NeedService } from '@/server/services/need';
import { Kanban } from '@/components/need-kanban';

type KanbanItem = { id: string; title: string; category: string; contact: { id: string; name: string } | null };

export default async function NeedsPage() {
  const groups = await NeedService.kanban();

  const total = Object.values(groups).reduce((s, arr) => s + arr.length, 0);

  const safeGroups: Record<string, KanbanItem[]> = {};
  for (const key of Object.keys(groups)) {
    safeGroups[key] = groups[key].map((n) => ({
      id: n.id,
      title: n.title,
      category: n.category,
      contact: n.contact ? { id: n.contact.id, name: n.contact.name } : null,
    }));
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">需求看板 · {total} 项</h1>
        <Link className="btn-primary" href="/needs/new">
          新建
        </Link>
      </div>
      <Kanban groups={safeGroups} />
    </main>
  );
}
