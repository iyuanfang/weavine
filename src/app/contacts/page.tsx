import Link from 'next/link';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { ContactCard } from '@/components/contact-card';

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; tag?: string };
}) {
  const [list, tags] = await Promise.all([
    ContactService.list({
      q: searchParams.q,
      tagId: searchParams.tag,
    }),
    TagService.list(),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">联系人</h1>
        <Link
          href="/contacts/new"
          className="btn-primary"
        >
          新建
        </Link>
      </div>

      <form action="/contacts" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={searchParams.q ?? ''}
          placeholder="搜索 姓名/公司/城市"
          className="input-base flex-1"
        />
        <select
          name="tag"
          defaultValue={searchParams.tag ?? ''}
          className="input-base"
        >
          <option value="">全部标签</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t._count.contacts})
            </option>
          ))}
        </select>
        <button className="btn-secondary">筛选</button>
      </form>

      <ul className="mt-4 grid gap-2">
        {list.length === 0 ? (
          <li className="py-6 text-center text-gray-500">暂无联系人</li>
        ) : (
          list.map((c) => <ContactCard key={c.id} contact={c} />)
        )}
      </ul>
    </main>
  );
}
