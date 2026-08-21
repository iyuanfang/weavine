import { NavLink, useLocation } from 'react-router-dom';

const primaryTabs = [
  { to: '/today', label: '今天', icon: '🎯', end: true },
  { to: '/contacts', label: '联系人', icon: '👥' },
  { to: '/actions', label: '待办', icon: '✅' },
  { to: '/calendar', label: '日程', icon: '📅' },
];

// Hide the bar on full-screen experiences that own the viewport.
function isFullScreenRoute(pathname: string): boolean {
  if (pathname.startsWith('/login')) return true;
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
          <span className="bottom-nav__icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="bottom-nav__label">{tab.label}</span>
        </NavLink>
      ))}
      <NavLink
        to="/more"
        className={({ isActive }) =>
          isActive ? 'bottom-nav__tab bottom-nav__tab--active' : 'bottom-nav__tab'
        }
      >
        <span className="bottom-nav__icon" aria-hidden="true">
          ⋯
        </span>
        <span className="bottom-nav__label">更多</span>
      </NavLink>
    </nav>
  );
}