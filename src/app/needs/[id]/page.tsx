import { notFound } from 'next/navigation';
import Link from 'next/link';
import { NeedService } from '@/server/services/need';
import { ContactService } from '@/server/services/contact';
import { transitionNeed, assignNeed, deleteNeed } from '@/app/needs/actions';

const NEXT: Record<string, string | null> = {
  open: 'matched',
  matched: 'in_progress',
  in_progress: 'closed',
  closed: null,
  cancelled: null,
};

export default async function NeedDetail({
  params,
}: {
  params: { id: string };
}) {
  let n;
  try {
    n = await NeedService.get(params.id);
  } catch {
    notFound();
  }

  const contacts = await ContactService.list({});

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{n.title}</h1>
        <div className="flex gap-2">
          <Link className="btn-secondary" href={`/needs/${n.id}/edit`}>
            编辑
          </Link>
          <form action={deleteNeed.bind(null, n.id)}>
            <button className="rounded border border-red-300 px-3 py-1 text-red-600">
              删除
            </button>
          </form>
        </div>
      </div>

      <p className="mt-1 text-sm text-gray-500">
        {n.category} · {n.status} · 优先级 {n.priority}
      </p>

      {n.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm">{n.description}</p>
      )}

      <section className="mt-6">
        <h2 className="font-semibold">关联联系人</h2>
        {n.contact ? (
          <p className="mt-1 text-sm">
            {n.contact.name}{' '}
            <Link
              className="ml-2 text-accent"
              href={`/contacts/${n.contact.id}`}
            >
              查看 →
            </Link>
          </p>
        ) : (
          <form action={assignNeed.bind(null, n.id)} className="mt-2 flex gap-2">
            <select name="contactId" className="input-base text-sm" required>
              <option value="">选择联系人</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button className="btn-secondary text-sm">关联</button>
          </form>
        )}
      </section>

      {NEXT[n.status] && (
        <form
          action={transitionNeed.bind(null, n.id, NEXT[n.status]!)}
          className="mt-4"
        >
          <button className="btn-primary text-sm">
            推进 → {NEXT[n.status]}
          </button>
        </form>
      )}
    </main>
  );
}
