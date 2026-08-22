import { useRef, useState } from 'react';
import { Popover } from './Popover';
import { cadenceLabel, effectiveCadenceDays } from '../lib/keepInTouch';

const PRESETS = [7, 14, 30, 60, 90, 180];

export function CadencePicker({
  importance,
  value,
  onChange,
}: {
  importance: string;
  /**
   * Current override in days. `null` = use importance default. The picker
   * also accepts `0` (the wire-format sentinel) and treats it as default.
   */
  value: number | null | undefined;
  onChange: (newValue: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const effective = effectiveCadenceDays(importance, value);
  const isOverridden = typeof value === 'number' && value > 0;
  const label =
    effective === null
      ? '不提醒'
      : isOverridden
        ? `自定义 · ${cadenceLabel(effective)}`
        : `默认 · ${cadenceLabel(effective)}`;

  const select = (next: number | null) => {
    onChange(next);
    setOpen(false);
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
        title="调整保持联系周期"
        className="badge"
        data-testid="cadence-picker-trigger"
        style={{
          background: isOverridden ? '#dbeafe' : '#f3f4f6',
          color: isOverridden ? '#1d4ed8' : '#4b5563',
          border: `1px solid ${isOverridden ? '#93c5fd' : 'transparent'}`,
          cursor: 'pointer',
        }}
      >
        🔁 {label}
      </button>
      <Popover
        anchorRef={triggerRef}
        open={open}
        align="bottom-end"
        onClose={() => setOpen(false)}
        className="picker-menu"
        style={{ minWidth: 180, padding: 4 }}
      >
        <div style={{ padding: '8px 12px 4px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          预设
        </div>
        {PRESETS.map((d) => {
          const active = value === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => select(d)}
              className={`picker-menu__item ${active ? 'picker-menu__item--active' : ''}`}
              data-testid={`cadence-picker-option-${d}`}
            >
              <span style={{ flex: 1 }}>{cadenceLabel(d)}</span>
              {active && <span>✓</span>}
            </button>
          );
        })}
        <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
        <button
          type="button"
          onClick={() => select(null)}
          className="picker-menu__item"
          data-testid="cadence-picker-default"
        >
          <span style={{ flex: 1 }}>
            {(() => {
              const d = effectiveCadenceDays(importance, null);
              return d === null ? '不提醒' : `使用默认（${cadenceLabel(d)}）`;
            })()}
          </span>
          {!isOverridden && <span>✓</span>}
        </button>
      </Popover>
    </>
  );
}