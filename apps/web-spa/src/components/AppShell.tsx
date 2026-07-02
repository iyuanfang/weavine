import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useLocalUser } from '../lib/auth';

const navItems = [
  { to: '/', label: '今天', icon: '🎯', end: true },
  { to: '/contacts', label: '联系人', icon: '👥' },
  { to: '/calendar', label: '日程', icon: '📅' },
  { to: '/actions', label: '待办', icon: '✅' },
  { to: '/reminders', label: '提醒', icon: '🔔' },
  { to: '/tags', label: '标签', icon: '🏷️' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading: userLoading } = useLocalUser();
  const adapter = useAdapter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: tags } = useQuery({
    queryKey: ['tags', user?.id],
    queryFn: () => adapter.tags.list(user!.id),
    enabled: Boolean(user?.id),
  });

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  useEffect(() => {
    setDrawerOpen(false);
  }, []);

  const nav = (
    <>
      <div className="app-shell__brand">
        <span>PRM</span>
        <button
          type="button"
          className="app-shell__close"
          onClick={() => setDrawerOpen(false)}
          aria-label="关闭菜单"
        >
          ✕
        </button>
      </div>

      <nav className="app-shell__menu">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) =>
              isActive
                ? 'app-shell__menu-item app-shell__menu-item--active'
                : 'app-shell__menu-item'
            }
          >
            <span className="app-shell__menu-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {tags && tags.length > 0 && (
        <div className="app-shell__tags">
          <div className="app-shell__tags-title">我的标签</div>
          {tags.map((tag) => (
            <NavLink
              key={tag.id}
              to={`/tags/${tag.id}`}
              onClick={() => setDrawerOpen(false)}
              className="app-shell__tag-row"
            >
              <span
                className="app-shell__tag-dot"
                style={{ backgroundColor: tag.color ?? '#9ca3af' }}
              />
              <span className="app-shell__tag-name">{tag.name}</span>
            </NavLink>
          ))}
        </div>
      )}

      <div className="app-shell__user">
        {userLoading ? '加载中…' : user?.name ?? user?.email ?? '未登录'}
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <aside className="app-shell__nav app-shell__nav--desktop">{nav}</aside>

      <button
        type="button"
        className="app-shell__hamburger"
        onClick={() => setDrawerOpen(true)}
        aria-label="打开菜单"
      >
        ☰
      </button>

      {drawerOpen && (
        <div
          className="app-shell__backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`app-shell__nav app-shell__nav--drawer ${
          drawerOpen ? 'app-shell__nav--open' : ''
        }`}
        aria-hidden={!drawerOpen}
      >
        {nav}
      </aside>

      <main className="app-shell__main">{children}</main>
    </div>
  );
}