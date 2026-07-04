import { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { isTauri } from '../lib/adapter';
import { useLocalUser } from '../lib/auth';
import { clearSession } from '../lib/auth/storage';

const navItems = [
  { to: '/', label: '今天', icon: '🎯', end: true },
  { to: '/contacts', label: '联系人', icon: '👥' },
  { to: '/actions', label: '待办', icon: '✅' },
  { to: '/calendar', label: '日程', icon: '📅' },
  { to: '/projects', label: '项目', icon: '📁' },
  { to: '/reminders', label: '提醒', icon: '🔔' },
  { to: '/tags', label: '标签', icon: '🏷️' },
  { to: '/archive', label: '归档', icon: '📦' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading: userLoading } = useLocalUser();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showArchiveTip, setShowArchiveTip] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('archive-tip-dismissed') !== '1';
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
        <img src="/logo.svg" alt="Weavine" className="app-shell__brand-logo" />
        <span className="app-shell__brand-text">Weavine</span>
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

      <div className="app-shell__user">
        <span className="app-shell__user-name">
          {userLoading ? '加载中…' : user?.name ?? user?.email ?? '未登录'}
        </span>
        {!isTauri && (
          <button
            type="button"
            className="app-shell__user-logout"
            onClick={() => {
              clearSession();
              window.location.href = '/login';
            }}
            aria-label="退出登录"
            title="退出登录"
          >
            登出
          </button>
        )}
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

      <main className="app-shell__main">
        {showArchiveTip && (
          <div
            className="card"
            role="note"
            style={{
              margin: '12px 16px 0',
              padding: '10px 14px',
              fontSize: 13,
              lineHeight: 1.6,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              background: 'var(--accent-soft, rgba(139, 92, 246, 0.08))',
              border: '1px solid var(--accent, #8b5cf6)',
            }}
          >
            <span>
              📦 <strong>v0.1.7 新增 自动归档</strong>。
              已完成超过 1 天的待办、已结束的日程、收尾超过 7 天的项目会自动归档到
              <Link to="/archive" style={{ marginLeft: 4 }}>
                /archive
              </Link>
              。
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                localStorage.setItem('archive-tip-dismissed', '1');
                setShowArchiveTip(false);
              }}
              aria-label="关闭提示"
              style={{ flexShrink: 0 }}
            >
              知道了
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}