import { NavLink } from 'react-router-dom';

const primary = [
  { to: '/today', label: '今天', icon: '🎯' },
  { to: '/contacts', label: '联系人', icon: '👥' },
  { to: '/actions', label: '待办', icon: '✅' },
  { to: '/calendar', label: '日程', icon: '📅' },
];

const secondary = [
  { to: '/projects', label: '项目', icon: '📁' },
  { to: '/reminders', label: '提醒', icon: '🔔' },
  { to: '/tags', label: '标签', icon: '🏷️' },
  { to: '/archive', label: '归档', icon: '📦' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

export function MoreMenu() {
  return (
    <div style={{ padding: '20px 16px', maxWidth: 720, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0 }}>更多</h1>
        <p style={{ color: 'var(--muted)', margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
          所有页面都在这里
        </p>
      </header>

      <section style={{ marginBottom: 24 }}>
        <h2
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--muted)',
            margin: '0 0 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          常用
        </h2>
        <Grid items={primary} />
      </section>

      <section>
        <h2
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--muted)',
            margin: '0 0 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          其他
        </h2>
        <Grid items={secondary} />
      </section>
    </div>
  );
}

function Grid({ items }: { items: { to: string; label: string; icon: string }[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: 8,
      }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '14px 8px',
            borderRadius: 10,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border)',
            textDecoration: 'none',
            color: 'var(--text, #111)',
            fontSize: 'var(--text-sm)',
            transition: 'background 120ms ease, border-color 120ms ease',
          }}
        >
          <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden="true">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}