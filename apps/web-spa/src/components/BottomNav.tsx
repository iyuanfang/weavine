import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { MoreSheet } from './MoreSheet';

const primaryTabs = [
  { to: '/today', label: '今天', icon: '🎯', end: true },
  { to: '/contacts', label: '联系人', icon: '👥' },
  { to: '/actions', label: '待办', icon: '✅' },
  { to: '/calendar', label: '日程', icon: '📅' },
];

function isFullScreenRoute(pathname: string): boolean {
  if (pathname.startsWith('/login')) return true;
  return false;
}

export function BottomNav() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  if (isFullScreenRoute(pathname)) return null;
  return (
    <>
      <nav className="bottom-nav" aria-label="主导航">
        {primaryTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              isActive ? 'bottom-nav__tab bottom-nav__tab--active' : 'bottom-nav__tab'
            }
          >
            <span className="bottom-nav__icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="bottom-nav__label">{tab.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`bottom-nav__tab ${moreOpen ? 'bottom-nav__tab--active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-label="打开更多"
          aria-expanded={moreOpen}
        >
          <span className="bottom-nav__icon" aria-hidden="true">
            ⋯
          </span>
          <span className="bottom-nav__label">更多</span>
        </button>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}