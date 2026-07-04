import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string | null;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  options: PickerOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
}

export function SearchablePicker({
  value,
  onChange,
  options,
  placeholder = '搜索…',
  emptyText = '没有匹配的项',
  disabled,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      const recalc = () => {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      };
      recalc();
      requestAnimationFrame(() => inputRef.current?.focus());
      window.addEventListener('scroll', recalc, true);
      window.addEventListener('resize', recalc);
      return () => {
        window.removeEventListener('scroll', recalc, true);
        window.removeEventListener('resize', recalc);
      };
    }
  }, [open]);

  const commit = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  const clear = () => {
    onChange('');
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[highlight];
      if (pick) commit(pick.id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const displayValue = open
    ? query
    : selected
    ? selected.label
    : '';

  const dropdown =
    open && pos ? (
      <div
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 99999,
          maxHeight: 280,
          overflowY: 'auto',
          background: 'var(--surface, #fff)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '14px 12px',
              color: 'var(--muted)',
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            {emptyText}
          </div>
        ) : (
          filtered.map((opt, idx) => {
            const isSel = opt.id === value;
            const isHi = idx === highlight;
            return (
              <div
                key={opt.id}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(opt.id);
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: isHi ? 'var(--accent-soft, #eff6ff)' : 'transparent',
                  borderLeft: isSel
                    ? '3px solid var(--accent)'
                    : '3px solid transparent',
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: isSel ? 600 : 400 }}>
                  {opt.label}
                </div>
                {opt.sublabel && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--muted)',
                      marginTop: 2,
                    }}
                  >
                    {opt.sublabel}
                  </div>
                  )}
              </div>
            );
          })
        )}
      </div>
    ) : null;

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          padding: '0 8px',
          minHeight: 38,
        }}
      >
        <input
          ref={inputRef}
          className="input-base"
          style={{ border: 'none', outline: 'none', flex: 1, padding: '8px 0' }}
          value={displayValue}
          placeholder={selected ? selected.label : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {selected && !open && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            aria-label="清除"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--muted)',
              fontSize: 14,
              padding: 4,
            }}
          >
            ✕
          </button>
        )}
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>▾</span>
      </div>

      {createPortal(dropdown, document.body)}
    </div>
  );
}