import { NavLink, useLocation } from 'react-router-dom';

import { TabIcon, type TabIconName } from './TabIcons';

interface PrimaryTab {
  to: string;
  label: string;
  icon: TabIconName;
  end: boolean;
}

const primaryTabs: PrimaryTab[] = [
  { to: '/today', label: '今天', icon: 'today', end: true },
  { to: '/contacts', label: '人脉', icon: 'contacts', end: false },
  { to: '/actions', label: '待办', icon: 'actions', end: false },
  { to: '/calendar', label: '日程', icon: 'calendar', end: false },
  { to: '/notes', label: '笔记', icon: 'note', end: false },
];

function isFullScreenRoute(pathname: string): boolean {
  if (pathname.startsWith('/login')) return true;
  if (pathname.startsWith('/graph-mobile')) return true;
  return false;
}

export function BottomNav() {
  const { pathname } = useLocation();
  if (isFullScreenRoute(pathname)) return null;
  return (
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
          {({ isActive }) => (
            <>
              <span className="bottom-nav__icon" aria-hidden="true">
                <TabIcon name={tab.icon} active={isActive} />
              </span>
              <span className="bottom-nav__label">{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

