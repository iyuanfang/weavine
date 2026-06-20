'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useRef } from 'react';

type Props = {
  tags: { id: string; name: string; _count: { contacts: number } }[];
};

export function ContactsToolbar({ tags }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);

  function submit() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const params = new URLSearchParams();
    const q = data.get('q') as string;
    const sort = data.get('sort') as string;
    const tag = data.get('tag') as string;
    if (q) params.set('q', q);
    if (sort && sort !== 'recent') params.set('sort', sort);
    if (tag) params.set('tag', tag);
    const qs = params.toString();
    router.push(qs ? `/contacts?${qs}` : '/contacts');
  }

  return (
    <form ref={formRef} className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input
        name="q"
        defaultValue={searchParams.get('q') ?? ''}
        placeholder="搜索 昵称/姓名/公司/城市"
        className="input-base flex-1"
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <select
        name="sort"
        defaultValue={searchParams.get('sort') ?? 'recent'}
        onChange={submit}
        className="input-base w-32"
      >
        <option value="recent">最近联系</option>
        <option value="importance">重要度优先</option>
        <option value="name">姓名 A-Z</option>
      </select>
      <select
        name="tag"
        defaultValue={searchParams.get('tag') ?? ''}
        onChange={submit}
        className="input-base w-36"
      >
        <option value="">全部标签</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t._count.contacts})
          </option>
        ))}
      </select>
    </form>
  );
}
