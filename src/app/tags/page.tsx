import { TagService } from '@/server/services/tag';
import { createTag, renameTag, deleteTag } from './actions';
import { tagColor } from '@/lib/tag-color';

export default async function TagsPage() {
  const tags = await TagService.list();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">标签</h1>

      <form action={createTag} className="mt-4 flex gap-2">
        <input
          name="name"
          required
          placeholder="新标签名"
          className="input-base flex-1"
        />
        <button className="btn-primary">添加</button>
      </form>

      <ul className="mt-4 divide-y">
        {tags.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <span
              className="rounded px-2.5 py-1 text-xs font-medium"
              style={{ background: tagColor(t.name).bg, color: tagColor(t.name).text }}
            >
              {t.name}
            </span>
            <span className="text-sm text-gray-500">
              {t._count.contacts} 人
            </span>

            <form
              action={renameTag.bind(null, t.id)}
              className="ml-auto flex gap-1"
            >
              <input
                name="name"
                defaultValue={t.name}
                className="input-base w-24 text-sm"
              />
              <button className="btn-secondary text-sm">改名</button>
            </form>

            <form action={deleteTag.bind(null, t.id)}>
              <button className="rounded border border-red-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50">
                删除
              </button>
            </form>
          </li>
        ))}
        {tags.length === 0 && (
          <li className="py-6 text-center text-sm text-gray-500">
            暂无标签，创建一个开始分类。
          </li>
        )}
      </ul>
    </main>
  );
}
