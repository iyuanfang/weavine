import { useState, useRef, useEffect } from 'react';
import { Popover } from './Popover';
import type { CategoryPreset } from './categoryPresets';

export function CategoryPicker({
  value,
  presets,
  onChange,
  compact,
}: {
  value: string | null | undefined;
  presets: CategoryPreset[];
  onChange: (newValue: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const presetMap = Object.fromEntries(presets.map((p) => [p.value, p]));
  const current = presetMap[value ?? ''] ?? {
    label: value || '未分类',
    icon: '⚪',
    color: '#9ca3af',
  };
  const isCustom = !presetMap[value ?? ''];

  const close = () => {
    setOpen(false);
    setAdding(false);
    setNewName('');
  };

  useEffect(() => {
    if (adding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [adding]);

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    onChange(name);
    close();
  };

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
        title="切换分类"
        className="tag-chip"
        style={{
          borderColor: open ? current.color : 'var(--border)',
          background: open ? `${current.color}18` : `${current.color}14`,
          color: current.color,
          fontWeight: 500,
          padding: compact ? '2px 8px' : '3px 10px',
          fontSize: compact ? 11 : 12,
          cursor: 'pointer',
        }}
      >
        <span style={{ marginRight: 4 }}>{current.icon}</span>
        {current.label}
        <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 'var(--text-xs)' }}>▾</span>
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        className="picker-menu"
        style={{ minWidth: 200, padding: 4 }}
      >
        {presets.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                close();
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

        {isCustom && value && (
          <>
            <div
              style={{
                height: 1,
                background: 'var(--border)',
                margin: '4px 0',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                fontSize: 'var(--text-base)',
                color: 'var(--fg)',
                fontWeight: 600,
              }}
            >
              <span style={{ fontSize: 'var(--text-base)' }}>⚪</span>
              <span style={{ flex: 1 }}>{value}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>自定义</span>
            </div>
          </>
        )}

        <div
          style={{
            height: 1,
            background: 'var(--border)',
            margin: '4px 0',
          }}
        />

        {adding ? (
          <div
            style={{
              padding: '6px 8px',
              display: 'flex',
              gap: 6,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="input-base input-sm"
              style={{ flex: 1, padding: '4px 8px' }}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="输入名称，回车保存"
            />
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleAdd}
              disabled={!newName.trim()}
              style={{ padding: '4px 10px' }}
            >
              ✓
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="picker-menu__item"
            style={{
              color: 'var(--accent)',
              fontWeight: 400,
            }}
          >
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 600 }}>+</span>
            <span style={{ flex: 1 }}>自定义</span>
          </button>
        )}
      </Popover>
    </>
  );
}
