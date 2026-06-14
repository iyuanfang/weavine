'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function SearchBar() {
  const r = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        r.push('/search?q=' + encodeURIComponent(q));
      }}
      className="flex gap-1"
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索 例：北京 合作 找前端"
        className="rounded border border-gray-300 px-2 py-1 text-sm w-72"
      />
      <button type="submit" className="rounded border border-gray-300 px-2 text-sm hover:bg-gray-50">
        搜索
      </button>
    </form>
  );
}
