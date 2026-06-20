'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { Parsed } from '@/server/search/parser';
import type { Hit } from '@/server/search/executor';
import { tagColor } from '@/lib/tag-color';
import { actionStatusLabel } from '@/lib/action-status';

type SearchData = {
  hits: Hit[];
  parsed: Parsed;
};

export function SearchResults({ q }: { q: string }) {
  const { data, isLoading, isError } = useQuery<SearchData>({
    queryKey: ['search', q],
    queryFn: async () => {
      const res = await fetch('/api/search?q=' + encodeURIComponent(q));
      if (!res.ok) throw new Error('搜索失败');
      return res.json();
    },
    enabled: q.length > 0,
  });

  if (!q) {
    return (
      <p className="mt-6 text-sm text-gray-500">
        试着输入「北京 合作 找前端」或「上海 投资人」之类的描述。
      </p>
    );
  }

  if (isLoading) {
    return <p className="mt-6 text-sm">搜索中…</p>;
  }

  if (isError) {
    return <p className="mt-6 text-sm text-red-600">搜索出错，请稍后再试。</p>;
  }

  if (!data) return null;

  const contacts = data.hits.filter((h) => h.type === 'contact');
  const actions = data.hits.filter((h) => h.type === 'action');
  const events = data.hits.filter((h) => h.type === 'event');

  return (
    <div className="mt-6">
      {data.parsed.chips.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {data.parsed.chips.map((c, i) => (
            <span
              key={i}
              className="rounded bg-accent/10 px-2 py-1 text-accent"
            >
              {c.kind}: {c.value}
            </span>
          ))}
        </div>
      )}

      {data.hits.length === 0 ? (
        <p className="text-sm text-gray-500">没有匹配的结果。</p>
      ) : (
        <div className="space-y-6">
          {contacts.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-gray-500">联系人 ({contacts.length})</h3>
              <ul className="mt-2 space-y-2">
                {contacts.map((h) => (
                  <li key={h.id} className="card hover:bg-gray-50">
                    <Link className="font-medium text-accent" href={`/contacts/${h.id}`}>
                      {h.nickname ?? h.name ?? '?'}
                    </Link>
                    {h.name && h.name !== h.nickname && (
                      <span className="ml-2 text-xs text-gray-500">({h.name})</span>
                    )}
                    <div className="mt-1 text-gray-500">
                      {[h.company, h.city].filter(Boolean).join(' · ')}
                    </div>
                    {h.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {h.tags.map((ct) => {
                          const c = tagColor(ct.tag.name);
                          return (
                            <span
                              key={ct.tag.id}
                              className="badge"
                              style={{ background: c.bg, color: c.text }}
                            >
                              {ct.tag.name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {actions.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-gray-500">待办 ({actions.length})</h3>
              <ul className="mt-2 space-y-2">
                {actions.map((h) => (
                  <li key={h.id} className="card hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <Link className="font-medium text-accent hover:underline" href={`/actions/${h.id}`}>
                        {h.title}
                      </Link>
                      <span className="text-xs text-gray-500">
                        {actionStatusLabel(h.status)}
                        {h.priority > 0 && ` · P${h.priority}`}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {h.contact && <span>→ {h.contact.nickname ?? h.contact.name ?? '?'} · </span>}
                      {h.dueAt ? `截止 ${new Date(h.dueAt).toLocaleDateString('zh-CN')}` : '无截止'}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {events.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-gray-500">日程 ({events.length})</h3>
              <ul className="mt-2 space-y-2">
                {events.map((h) => (
                  <li key={h.id} className="card hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <Link className="font-medium text-accent hover:underline" href={`/events/${h.id}`}>
                        {h.title}
                      </Link>
                      <span className="text-xs text-gray-500">
                        {new Date(h.startAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {[h.location, h.contact ? (h.contact.nickname ?? h.contact.name ?? '?') : null].filter(Boolean).join(' · ') || '无地点/参与人'}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
