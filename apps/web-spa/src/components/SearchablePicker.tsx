import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string | null;
  /**
   * Extra haystack to match against the search query, beyond
   * `label` and `sublabel`. Use for fields the picker shouldn't
   * display but the user still expects to find by typing
   * (e.g. a contact's English `name` when `nickname` is shown
   * as the primary label).
   */
  searchText?: string | null;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  options: PickerOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  emptyState?: React.ReactNode;
  footer?: React.ReactNode;
}

export function SearchablePicker({
  value,
  onChange,
  options,
  placeholder = '搜索…',
  emptyText = '没有匹配的项',
  disabled,
  emptyState,
  footer,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const haystack = [
        o.label,
        o.sublabel ?? '',
        o.searchText ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  // Cap visible rows so the dropdown stays usable with hundreds of contacts
  // (project picker can grow to a few thousand). Footer stays pinned below
  // the scrollable list so users can still click "新建联系人" without
  // scrolling past every match.
  const VISIBLE_ROW_CAP = 50;
  const visible = useMemo(
    () => filtered.slice(0, VISIBLE_ROW_CAP),
    [filtered],
  );
  const overflow = filtered.length - visible.length;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
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
        if (!rect) return;
        const DROPDOWN_MAX_H = 320;
        const MARGIN = 4;
        const vh = window.innerHeight;
        let top = rect.bottom + MARGIN;
        if (top + DROPDOWN_MAX_H > vh) {
          top = rect.top - DROPDOWN_MAX_H - MARGIN;
        }
        if (top < 0) top = 0;
        setPos({ top, left: rect.left, width: rect.width });
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
        ref={dropdownRef}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 99999,
          background: 'var(--surface, #fff)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 320,
        }}
      >
        <div
          style={{
            overflowY: 'auto',
            maxHeight: footer ? 240 : 280,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: '14px 12px',
                color: 'var(--muted)',
                fontSize: 'var(--text-base)',
                textAlign: 'center',
              }}
            >
              {options.length === 0 && emptyState ? emptyState : emptyText}
            </div>
          ) : (
            visible.map((opt, idx) => {
              const isSel = opt.id === value;
              const isHi = idx === highlight;
              return (
                <div
                  key={opt.id}
                  data-testid="searchable-picker-option"
                  data-option-id={opt.id}
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
                    fontSize: 'var(--text-base)',
                  }}
                >
                  <div style={{ fontWeight: isSel ? 600 : 400 }}>
                    {opt.label}
                  </div>
                  {opt.sublabel && (
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
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
          {overflow > 0 && (
            <div
              style={{
                padding: '8px 12px',
                fontSize: 'var(--text-sm)',
                color: 'var(--muted)',
                textAlign: 'center',
              }}
            >
              还有 {overflow} 条匹配，输入关键词以缩小范围
            </div>
          )}
        </div>
        {footer && (
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 8,
              flexShrink: 0,
              background: 'var(--surface, #fff)',
            }}
          >
            {footer}
          </div>
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
              fontSize: 'var(--text-base)',
              padding: 4,
            }}
          >
            ✕
          </button>
        )}
        <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>▾</span>
      </div>

      {createPortal(dropdown, document.body)}
    </div>
  );
}