'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/(auth)/actions';
import { BRAND } from '@/lib/brand';
import { BrandMark } from '@/components/brand-mark';

const CommandPalette = dynamic(() => import('./command-palette').then(mod => mod.CommandPalette), { ssr: false });

const NAV_LINKS = [
  { href: '/today', label: '今天' },
  { href: '/contacts', label: '联系人' },
  { href: '/calendar', label: '日程' },
  { href: '/actions', label: '待办' },
  { href: '/reminders', label: '提醒' },
  { href: '/tags', label: '标签' },
] as const;

type CurrentUser = { name: string | null; image: string | null; email: string | null };

export function TopNav({
  currentUser,
  isDesktop = false,
}: {
  currentUser: CurrentUser;
  isDesktop?: boolean;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  const display = currentUser.name || currentUser.email || '?';
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-6xl flex items-center gap-3 p-3">
        <Link
          href="/"
          className="inline-flex shrink-0 items-center gap-1.5"
          aria-label={`${BRAND.name} · ${BRAND.slogan}`}
          aria-current={pathname === '/' ? 'page' : undefined}
        >
          <BrandMark className="h-3.5 w-8 text-accent" aria-hidden />
          <span className="font-semibold tracking-tight text-gray-900">
            {BRAND.name} · {BRAND.slogan}
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 pl-2 border-l border-gray-200">
            <div className="h-7 w-7 rounded-full bg-gray-200 text-center text-xs leading-7">
              {display.slice(0, 1).toUpperCase()}
            </div>
            {!isDesktop && (
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  退出
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
      <nav
        className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 border-t border-gray-100 px-3 py-2 text-sm text-gray-700 sm:gap-3 sm:border-t-0 sm:py-0 sm:pb-3"
        aria-label="主导航"
      >
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="rounded px-2 py-1 hover:bg-gray-100 hover:text-accent"
            aria-current={isActive(href) ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
        <span className="ml-auto" />
        <CommandPalette />
      </nav>
    </header>
  );
}
