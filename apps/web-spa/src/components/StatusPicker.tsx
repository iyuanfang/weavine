import { useRef, useState } from 'react';
import { Popover } from './Popover';

const STATUS_OPTIONS: { value: string; label: string; color: string; icon: string }[] = [
  { value: 'inbox', label: '收件箱', color: '#6b7280', icon: '📥' },
  { value: 'open', label: '进行中', color: '#3b82f6', icon: '🔨' },
  { value: 'waiting', label: '等待中', color: '#f59e0b', icon: '⏳' },
  { value: 'done', label: '已完成', color: '#10b981', icon: '✅' },
];

const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));

export function statusMeta(value: string): { label: string; color: string; icon: string } {
  return (
    STATUS_MAP[value] ?? {
      label: value,
      color: '#9ca3af',
      icon: '·',
    }
  );
}

export function StatusPicker({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (newValue: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const meta = statusMeta(value);

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
        title="切换状态"
        className="tag-chip"
        style={{
          borderColor: open ? meta.color : 'var(--border)',
          background: open ? `${meta.color}18` : 'var(--bg-elev)',
          color: meta.color,
          fontWeight: 500,
          padding: compact ? '2px 8px' : '3px 10px',
          fontSize: compact ? 11 : 12,
          cursor: 'pointer',
        }}
      >
        <span style={{ marginRight: 4 }}>{meta.icon}</span>
        {meta.label}
        <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 'var(--text-xs)' }}>▾</span>
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        className="picker-menu"
        style={{ minWidth: 160, padding: 4 }}
      >
        {STATUS_OPTIONS.map((opt) => {
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
              <span style={{ fontSize: 'var(--text-base)' }}>{opt.icon}</span>
              <span style={{ flex: 1 }}>{opt.label}</span>
              {active && <span style={{ fontSize: 'var(--text-sm)' }}>✓</span>}
            </button>
          );
        })}
      </Popover>
    </>
  );
}
