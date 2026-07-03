import { useRef, useState } from 'react';
import { Popover } from './Popover';

const OPTIONS: { value: number; label: string; color: string }[] = [
  { value: 0, label: '无', color: '#d1d5db' },
  { value: 1, label: '低', color: '#6b7280' },
  { value: 2, label: '中', color: '#f59e0b' },
  { value: 3, label: '高', color: '#ef4444' },
];

const META = Object.fromEntries(OPTIONS.map((o) => [o.value, o]));

export function priorityMeta(value: number): { label: string; color: string } {
  return META[value] ?? { label: String(value), color: '#9ca3af' };
}

export function PriorityPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (newValue: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const meta = priorityMeta(value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="切换优先级"
        aria-label="优先级"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 999,
          background: 'transparent',
          border: `1px solid ${open ? meta.color : 'transparent'}`,
          color: meta.color,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          transition: `all var(--transition)`,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: meta.color,
          }}
        />
        {meta.label}
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
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
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
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
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: opt.color,
                }}
              />
              <span style={{ flex: 1 }}>{opt.label}</span>
              {active && <span style={{ fontSize: 12 }}>✓</span>}
            </button>
          );
        })}
      </Popover>
    </>
  );
}
