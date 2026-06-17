import { Suspense } from 'react';
import { SearchBar } from '@/components/search-bar';
import { SearchResults } from '@/components/search-results';
import { SearchClientWrapper } from './client-wrapper';

export default function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = searchParams.q ?? '';

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">搜索联系人</h1>
      <Suspense fallback={<div className="text-sm text-gray-500 mt-2">...</div>}>
        <SearchBar />
      </Suspense>
      <SearchClientWrapper>
        <SearchResults q={q} />
      </SearchClientWrapper>
    </main>
  );
}
