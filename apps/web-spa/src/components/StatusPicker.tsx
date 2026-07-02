import { useState, useRef, useEffect } from 'react';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const meta = statusMeta(value);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(!open);
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
        <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            minWidth: 160,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
            animation: 'popover-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {STATUS_OPTIONS.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: active ? `${opt.color}14` : 'transparent',
                  color: active ? opt.color : 'var(--fg)',
                  fontWeight: active ? 600 : 400,
                  fontSize: 13,
                  border: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 100ms',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--bg-subtle)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ fontSize: 14 }}>{opt.icon}</span>
                <span style={{ flex: 1 }}>{opt.label}</span>
                {active && <span style={{ fontSize: 12 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}