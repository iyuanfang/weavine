'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { Parsed, Chip } from '@/server/search/parser';
import { tagColor } from '@/lib/tag-color';

type Hit = {
  id: string;
  name: string;
  company: string | null;
  city: string | null;
  tags: { tag: { id: string; name: string; color: string | null } }[];
};

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
        <p className="text-sm text-gray-500">没有匹配的联系人。</p>
      ) : (
        <ul className="space-y-2">
          {data.hits.map((h) => (
            <li
              key={h.id}
              className="card hover:bg-gray-50"
            >
              <Link className="font-medium text-accent" href={`/contacts/${h.id}`}>
                {h.name}
              </Link>
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
      )}
    </div>
  );
}
