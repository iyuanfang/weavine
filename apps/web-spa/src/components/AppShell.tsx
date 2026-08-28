import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';

import { isTauri } from '../lib/adapter';
import { useLocalUser } from '../lib/auth';
import { clearSession } from '../lib/auth/storage';
import { useQuickCapture, useGlobalSearch } from '../App';
import { BottomNav } from './BottomNav';

const navItems = [
  { to: '/today', label: '今天', icon: '🎯', end: true },
  { to: '/contacts', label: '联系人', icon: '👥' },
  { to: '/actions', label: '待办', icon: '✅' },
  { to: '/calendar', label: '日程', icon: '📅' },
  { to: '/notes', label: '笔记', icon: '📝' },
  { to: '/projects', label: '项目', icon: '📁' },
  { to: '/tags', label: '标签', icon: '🏷️' },
  { to: '/archive', label: '归档', icon: '📦' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

function shortcutLabel(): string {
  return '\\';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading: userLoading } = useLocalUser();
  const { open: openQuickCapture } = useQuickCapture();
  const { open: openSearch } = useGlobalSearch();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('weavine:sidebar-collapsed') === '1';
  });
  const [showReleaseTip, setShowReleaseTip] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('v108-tip-dismissed') !== '1';
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('weavine:sidebar-collapsed', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

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
      <button
        type="button"
        className="app-shell__search"
        onClick={() => {
          openSearch();
          setDrawerOpen(false);
        }}
        aria-label="搜索"
      >
        <span className="app-shell__search-icon" aria-hidden="true">
          🔍
        </span>
        <span className="app-shell__search-text">搜索…</span>
        <kbd className="app-shell__search-kbd">/</kbd>
      </button>

      <div className="app-shell__brand">
        <img src="/logo.svg" alt="Weavine" className="app-shell__brand-logo" />
        <span className="app-shell__brand-text">Weavine</span>
        <span className="app-shell__brand-tagline">管好人和事</span>
        <button
          type="button"
          className="app-shell__close"
          onClick={() => setDrawerOpen(false)}
          aria-label="关闭菜单"
        >
          ✕
        </button>
      </div>

      <button
        type="button"
        className="app-shell__collapse"
        onClick={toggleCollapsed}
        aria-label={collapsed ? '展开菜单' : '收起菜单'}
        title={collapsed ? '展开菜单' : '收起菜单'}
      >
        {collapsed ? '»' : '«'}
      </button>

      <nav className="app-shell__menu">
        <button
          type="button"
          className="app-shell__menu-item app-shell__menu-item--quick"
          onClick={() => {
            openQuickCapture('');
            setDrawerOpen(false);
          }}
          title="快速记录"
        >
          <span className="app-shell__menu-icon">⚡</span>
          <span>快速记录</span>
          <kbd className="app-shell__menu-kbd">{shortcutLabel()}</kbd>
        </button>

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
            title={item.label}
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
      <aside
        className={`app-shell__nav app-shell__nav--desktop ${
          collapsed ? 'app-shell__nav--collapsed' : ''
        }`}
      >
        {nav}
      </aside>

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
        {showReleaseTip && (
          <div
            className="card"
            role="note"
            style={{
              margin: '12px 16px 0',
              padding: '10px 14px',
              fontSize: 'var(--text-base)',
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
              📦 <strong>v1.0.8 新增</strong>：名片 OCR 扫描、语音输入、联系人头像、快速记录等。
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                localStorage.setItem('v108-tip-dismissed', '1');
                setShowReleaseTip(false);
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

      <BottomNav />
    </div>
  );
}