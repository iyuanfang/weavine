import { useEffect, useState } from 'react';

import { TYPE_META } from './EntityGraph';
import type { EntityGraphNodeType } from '../lib/adapter/types';

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const fn = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mobile;
}

function bulkBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '3px 6px',
    fontSize: 12,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    background: disabled ? '#f1f5f9' : '#fff',
    color: disabled ? '#94a3b8' : '#475569',
    cursor: disabled ? 'default' : 'pointer',
  };
}

interface Props {
  /** Filterable types, in display order. Only these render as chips. */
  types: readonly EntityGraphNodeType[];
  visible: ReadonlySet<EntityGraphNodeType>;
  onChange: (next: ReadonlySet<EntityGraphNodeType>) => void;
  /** Prefix for data-testids (e.g. "home-graph" or the center type). */
  testIdPrefix: string;
}

/**
 * Type-filter row shared by every graph surface (home weave, detail-page
 * graph tabs). Desktop: "筛选类型:" + 全选/全不选 + checkbox chips. Mobile:
 * the same row compressed to icon-only chips + compact bulk buttons, so
 * six types still fit one line on a 360px phone.
 */
export function GraphFilterRow({ types, visible, onChange, testIdPrefix }: Props) {
  const isMobile = useIsMobile();
  const toggle = (t: EntityGraphNodeType) => {
    const next = new Set(visible);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange(next);
  };

  if (isMobile) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '8px 14px 0',
          overflowX: 'auto',
        }}
        data-testid={`${testIdPrefix}-filters`}
      >
        <button
          type="button"
          data-testid={`${testIdPrefix}-filter-all`}
          onClick={() => onChange(new Set(types))}
          disabled={visible.size === types.length}
          style={bulkBtnStyle(visible.size === types.length)}
        >
          全选
        </button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-filter-none`}
          onClick={() => onChange(new Set())}
          disabled={visible.size === 0}
          style={bulkBtnStyle(visible.size === 0)}
        >
          全不选
        </button>
        {types.map((t) => {
          const meta = TYPE_META[t];
          const checked = visible.has(t);
          return (
            <button
              key={t}
              type="button"
              title={meta.label}
              aria-label={`${meta.label}${checked ? '（显示中）' : '（已隐藏）'}`}
              aria-pressed={checked}
              data-testid={`${testIdPrefix}-filter-${t}`}
              onClick={() => toggle(t)}
              style={{
                flexShrink: 0,
                width: 34,
                height: 32,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                border: `1.5px solid ${checked ? meta.color : '#e2e8f0'}`,
                borderRadius: 8,
                background: checked ? `${meta.color}10` : '#fff',
                opacity: checked ? 1 : 0.45,
                cursor: 'pointer',
              }}
            >
              {meta.icon}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        padding: '8px 14px 0',
      }}
      data-testid={`${testIdPrefix}-filters`}
    >
      <span style={{ fontSize: 12, color: '#64748b' }}>筛选类型:</span>
      <button
        type="button"
        data-testid={`${testIdPrefix}-filter-all`}
        onClick={() => onChange(new Set(types))}
        disabled={visible.size === types.length}
        style={bulkBtnStyle(visible.size === types.length)}
      >
        全选
      </button>
      <button
        type="button"
        data-testid={`${testIdPrefix}-filter-none`}
        onClick={() => onChange(new Set())}
        disabled={visible.size === 0}
        style={bulkBtnStyle(visible.size === 0)}
      >
        全不选
      </button>
      {types.map((t) => {
        const meta = TYPE_META[t];
        const checked = visible.has(t);
        return (
          <label
            key={t}
            data-testid={`${testIdPrefix}-filter-${t}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              border: `1px solid ${checked ? meta.color : '#e2e8f0'}`,
              borderRadius: 6,
              background: checked ? `${meta.color}10` : '#fff',
              fontSize: 13,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(t)}
              style={{ margin: 0 }}
            />
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
          </label>
        );
      })}
    </div>
  );
}
