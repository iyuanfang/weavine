import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { deleteContactAction } from '@/app/contacts/actions';

export default async function ContactDetail({
  params,
}: {
  params: { id: string };
}) {
  let c;
  try {
    c = await ContactService.get(params.id);
  } catch {
    notFound();
  }
  const tags = await TagService.list();

  const fields: [string, string | null | undefined][] = [
    ['公司', c.company],
    ['职位', c.title],
    ['城市', c.city],
    ['邮箱', c.email],
    ['电话', c.phone],
    ['微信', c.wechat],
    [
      '生日',
      c.birthdayMonth && c.birthdayDay
        ? `${String(c.birthdayMonth).padStart(2, '0')}-${String(c.birthdayDay).padStart(2, '0')}`
        : null,
    ],
  ];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <div className="flex gap-2">
          <Link
            className="btn-secondary"
            href={`/contacts/${c.id}/edit`}
          >
            编辑
          </Link>
          <form action={deleteContactAction.bind(null, c.id)}>
            <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
              删除
            </button>
          </form>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        {fields
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-gray-500">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        {c.tags.map((t) => (
          <span
            key={t.tag.id}
            className="rounded px-2 py-0.5 text-xs"
            style={{ background: t.tag.color ?? '#e5e7eb' }}
          >
            {t.tag.name}
          </span>
        ))}
      </div>

      {c.notes && (
        <section className="mt-6">
          <h2 className="font-semibold">备注</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
            {c.notes}
          </p>
        </section>
      )}

      <section className="mt-8 border-t pt-6">
        <h2 className="font-semibold">互动</h2>
        <p className="text-sm text-gray-500">在 Phase 3 启用。</p>
      </section>
    </main>
  );
}
