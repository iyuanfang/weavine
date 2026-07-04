import { useRef, useState } from 'react';
import { Popover } from './Popover';

const OPTIONS: { value: string; label: string; color: string; icon: string }[] = [
  { value: 'normal', label: '普通', color: '#9ca3af', icon: '⚪' },
  { value: 'low', label: '低', color: '#6b7280', icon: '⚪' },
  { value: 'medium', label: '中', color: '#f59e0b', icon: '🟡' },
  { value: 'high', label: '高', color: '#ef4444', icon: '🔴' },
];

const META = Object.fromEntries(OPTIONS.map((o) => [o.value, o]));

export function importanceMeta(value: string): { label: string; color: string; icon: string } {
  return META[value] ?? { label: value, color: '#9ca3af', icon: '·' };
}

export function ImportancePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (newValue: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const meta = importanceMeta(value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
        title="切换重要度"
        className="badge"
        style={{
          background: open ? `${meta.color}28` : `${meta.color}14`,
          color: meta.color,
          border: `1px solid ${open ? meta.color : 'transparent'}`,
          cursor: 'pointer',
        }}
      >
        {meta.icon} {meta.label}
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        align="bottom-end"
        onClose={() => setOpen(false)}
        className="picker-menu"
        style={{ minWidth: 140, padding: 4 }}
      >
        {OPTIONS.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`picker-menu__item ${active ? 'picker-menu__item--active' : ''}`}
              style={{
                color: active ? opt.color : 'var(--fg)',
                background: active ? `${opt.color}14` : 'transparent',
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ fontSize: 14 }}>{opt.icon}</span>
              <span style={{ flex: 1 }}>{opt.label}</span>
              {active && <span style={{ fontSize: 12 }}>✓</span>}
            </button>
          );
        })}
      </Popover>
    </>
  );
}
