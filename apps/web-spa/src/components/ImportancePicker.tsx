import { useState, useRef, useEffect } from 'react';

const OPTIONS: { value: string; label: string; color: string; icon: string }[] = [
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
  const containerRef = useRef<HTMLDivElement>(null);
  const meta = importanceMeta(value);

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

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            minWidth: 140,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
            animation: 'popover-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onClick={(e) => e.stopPropagation()}
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