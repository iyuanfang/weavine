'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SearchBar } from './search-bar';
import { QuickLog } from './quick-log';

const NAV_LINKS = [
  { href: '/today', label: '今天' },
  { href: '/contacts', label: '联系人' },
  { href: '/calendar', label: '日程' },
  { href: '/actions', label: 'Action' },
  { href: '/search', label: '搜索' },
  { href: '/tags', label: '标签' },
] as const;

export function TopNav({ contacts }: { contacts: { id: string; name: string }[] }) {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 p-3">
        <Link
          href="/"
          className="font-bold text-lg"
          aria-current={pathname === '/' ? 'page' : undefined}
        >
          PRM
        </Link>
        <nav className="flex gap-3 text-sm text-gray-700" aria-label="主导航">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="hover:text-accent"
              aria-current={isActive(href) ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Suspense fallback={null}>
            <SearchBar />
          </Suspense>
          <QuickLog contacts={contacts} />
        </div>
      </div>
    </header>
  );
}
