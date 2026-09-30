import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { isTauri } from '../lib/adapter';
import { useLocalUser } from '../lib/auth';
import { clearSession } from '../lib/auth/storage';
import { useAdapter } from '../lib/adapter';
import { useQuickCapture, useGlobalSearch } from '../App';
import { UpdateBanner } from './UpdateBanner';
import { BottomNav } from './BottomNav';
import { trackIdentify } from '../lib/analytics/marketai';

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

// Bottom-nav tabs — on mobile the drawer must not repeat these four.
const MOBILE_TAB_PATHS = new Set(['/today', '/contacts', '/actions', '/calendar', '/notes']);

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const fn = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mobile;
}

function timeAgo(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function shortcutLabel(): string {
  return '\\';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading: userLoading } = useLocalUser();
  const { open: openQuickCapture } = useQuickCapture();
  const { open: openSearch } = useGlobalSearch();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  const adapter = useAdapter();
  const navigate = useNavigate();
  const userId = user?.id ?? '';
  const [now] = useState(() => Date.now());

  // 云账号身份：已连接时左下角显示云账号 email（而非「本地用户」占位符），
  // 并作为桌面端/Android 的 MarketAI 身份来源——桌面壳没有登录页，
  // 云同步的 user_email 是唯一可靠的身份信号。
  const cloudStatusQuery = useQuery({
    queryKey: ['cloud-status'],
    queryFn: () => adapter.cloud.status(),
    staleTime: 60_000,
    retry: false,
  });
  const cloudEmail = cloudStatusQuery.data?.linked
    ? cloudStatusQuery.data.user_email
    : null;
  useEffect(() => {
    if (cloudEmail) trackIdentify({ email: cloudEmail });
  }, [cloudEmail]);

  // 近期 mixed timeline for the mobile drawer (same content as the desktop
  // drawer's nav, plus a time-ordered recent feed).
  const actionsQuery = useQuery({
    queryKey: ['drawer-actions', userId],
    queryFn: () => adapter.actions.list({ user_id: userId, limit: 8 }),
    enabled: isMobile && drawerOpen && !!userId,
  });
  const eventsQuery = useQuery({
    queryKey: ['drawer-events', userId],
    queryFn: () => adapter.events.list({ user_id: userId, limit: 8 }),
    enabled: isMobile && drawerOpen && !!userId,
  });
  const interactionsQuery = useQuery({
    queryKey: ['drawer-interactions', userId],
    queryFn: () => adapter.interactions.list({ user_id: userId, limit: 8 }),
    enabled: isMobile && drawerOpen && !!userId,
  });
  const notesQuery = useQuery({
    queryKey: ['drawer-notes', userId],
    queryFn: () => adapter.notes.list(userId, null),
    enabled: isMobile && drawerOpen && !!userId,
  });

  const feed: Array<{ key: string; icon: string; title: string; timeLabel: string; occurredAt: number; done: boolean; to: string }> = [];
  for (const a of actionsQuery.data ?? []) {
    feed.push({ key: `a:${a.id}`, icon: '✅', title: a.title, timeLabel: timeAgo(a.updated_at, now), occurredAt: new Date(a.updated_at).getTime() || 0, done: a.status === 'done', to: `/actions/${a.id}?from=/today` });
  }
  for (const e of eventsQuery.data ?? []) {
    feed.push({ key: `e:${e.id}`, icon: '📅', title: e.title, timeLabel: timeAgo(e.start_at, now), occurredAt: new Date(e.start_at).getTime() || 0, done: false, to: `/events/${e.id}?from=/today` });
  }
  for (const i of interactionsQuery.data ?? []) {
    feed.push({ key: `i:${i.id}`, icon: '💬', title: i.summary, timeLabel: timeAgo(i.occurred_at, now), occurredAt: new Date(i.occurred_at).getTime() || 0, done: false, to: `/interactions/${i.id}?from=/today` });
  }
  for (const n of notesQuery.data?.items ?? []) {
    feed.push({ key: `n:${n.id}`, icon: '📝', title: n.title, timeLabel: timeAgo(n.updated_at, now), occurredAt: new Date(n.updated_at).getTime() || 0, done: false, to: `/notes/${n.id}?from=/today` });
  }
  feed.sort((a, b) => b.occurredAt - a.occurredAt);
  const recentFeed = feed.slice(0, 10);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('weavine:sidebar-collapsed') === '1';
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

  // Mobile home's ☰ button (Today.tsx) opens this shell drawer — the mobile
  // branch of the Today page renders its own top bar, so the shell hamburger
  // is hidden there (CSS) and the event is the bridge.
  useEffect(() => {
    // Toggle, not open: the bottom-nav 更多 tab dispatches this too, and a
    // second tap there must CLOSE the drawer (WeChat 更多 behaviour).
    const toggle = () => setDrawerOpen((o) => !o);
    window.addEventListener('weavine:open-drawer', toggle);
    return () => window.removeEventListener('weavine:open-drawer', toggle);
  }, []);

  const nav = (
    <>
      {/* Search lives in the home top bar (🔍) on mobile — no drawer copy. */}
      {!isMobile && (
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
      )}

      {/* Mobile drawer: no brand block, no close/collapse buttons — the
          backdrop tap and system back close it, and the space goes to content. */}
      {!isMobile && (
        <>
          <div className="app-shell__brand">
            <img src="/logo.svg" alt="Weavine" className="app-shell__brand-logo" />
            <span className="app-shell__brand-text">Weavine</span>
            <span className="app-shell__brand-tagline">编织遇见的人脉</span>
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
        </>
      )}

      {isMobile && recentFeed.length > 0 && (
        <div className="app-shell__drawer-section">
          <div className="app-shell__drawer-section-title">近期</div>
          {recentFeed.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.to}
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) =>
                isActive
                  ? 'app-shell__menu-item app-shell__drawer-feed-row app-shell__menu-item--active'
                  : 'app-shell__menu-item app-shell__drawer-feed-row'
              }
            >
              <span className="app-shell__menu-icon">{entry.icon}</span>
              <span className={`app-shell__drawer-feed-title${entry.done ? ' app-shell__drawer-feed-title--done' : ''}`}>
                {entry.title}
              </span>
              <span className="app-shell__drawer-feed-time">{entry.timeLabel}</span>
            </NavLink>
          ))}
        </div>
      )}

      {/* The full page directory lives in the drawer on ALL viewports — it
          is the only entry point for 项目/标签/归档 etc. (the bottom nav
          carries 今天/人脉/待办/日程 but not these). 近期 sits above it. */}
      <nav className="app-shell__menu">
        {!isMobile && (
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
        )}

        {navItems
          .filter((item) => !isMobile || !MOBILE_TAB_PATHS.has(item.to))
          .map((item) => (
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

      <div
        className="app-shell__user"
        onClick={() => navigate('/settings')}
        style={{ cursor: 'pointer' }}
        title="账号与云同步"
      >
        {cloudEmail ? (
          <>
            <span style={{ color: 'var(--accent, #059669)', fontSize: 11 }} title="已连接云同步">☁</span>
            <span className="app-shell__user-name" style={{ fontSize: 12 }}>{cloudEmail}</span>
          </>
        ) : (
          <span className="app-shell__user-name">
            {userLoading ? '加载中…' : user?.name ?? user?.email ?? '未登录'}
          </span>
        )}
        {!isTauri && (
          <button
            type="button"
            className="app-shell__user-logout"
            onClick={(e) => {
              e.stopPropagation();
              clearSession();
              // SPA nav, not a full reload. See SearchPalette.tsx for the
              // full explanation of why `window.location.href` blanks the
              // Tauri production webview (no SPA history fallback).
              window.history.pushState({}, '', '/login');
              window.dispatchEvent(new PopStateEvent('popstate'));
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
        <UpdateBanner />

        {children}
      </main>

      <BottomNav />
    </div>
  );
}