// Linear stroke icons for the mobile bottom nav, WeChat-style: 24px viewBox,
// 1.5px stroke, currentColor. Unselected tabs render gray; the active tab is
// colored by `.bottom-nav__tab--active` (green) with a soft fill inside the
// icon shapes (the `fill-active` class below keeps non-active shapes hollow).
import type { ReactNode } from 'react';

export type TabIconName = 'today' | 'contacts' | 'actions' | 'calendar' | 'more';

function Icon({ children, filled }: { children: ReactNode; filled: boolean }): ReactNode {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  );
}

export function TabIcon({ name, active }: { name: TabIconName; active: boolean }): ReactNode {
  switch (name) {
    case 'today':
      // ◎ center dot in a ring
      return (
        <Icon filled={false}>
          <circle cx="12" cy="12" r="8.5" fill={active ? 'var(--accent-soft, #ecfdf5)' : 'none'} />
          <circle cx="12" cy="12" r="3.2" fill={active ? 'currentColor' : 'none'} />
        </Icon>
      );
    case 'contacts':
      // two person outlines
      return (
        <Icon filled={false}>
          <circle cx="9" cy="8.5" r="3" fill={active ? 'var(--accent-soft, #ecfdf5)' : 'none'} />
          <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" fill="none" />
          <circle cx="16.5" cy="9.5" r="2.4" fill="none" />
          <path d="M16.5 14.2c2.2.2 3.7 1.7 4.2 4.3" fill="none" />
        </Icon>
      );
    case 'actions':
      // rounded square + check
      return (
        <Icon filled={false}>
          <rect x="4" y="4" width="16" height="16" rx="4.5" fill={active ? 'var(--accent-soft, #ecfdf5)' : 'none'} />
          <path d="M8.5 12.2l2.4 2.4 4.8-5" fill="none" strokeWidth={1.8} />
        </Icon>
      );
    case 'calendar':
      // calendar page
      return (
        <Icon filled={false}>
          <rect x="4" y="5.5" width="16" height="14.5" rx="3" fill={active ? 'var(--accent-soft, #ecfdf5)' : 'none'} />
          <path d="M4 10h16" fill="none" />
          <path d="M8.5 3.5v3M15.5 3.5v3" fill="none" />
          {active && <circle cx="12" cy="15" r="2" fill="currentColor" stroke="none" />}
        </Icon>
      );
    case 'more':
      // three horizontal lines with dots (☰-ish)
      return (
        <Icon filled={false}>
          <path d="M4 7h16M4 12h16M4 17h16" fill="none" />
        </Icon>
      );
  }
}