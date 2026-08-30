import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { EntityGraph, ALL_TYPES, GRAPH_NODE_CAP, TYPE_META } from './EntityGraph';
import { GraphQuickCreateModal, type CreateKind, type GraphCenter } from './GraphQuickCreateModal';
import { emit } from '../lib/telemetry';
import type { EntityGraphNode, EntityGraphNodeType } from '../lib/adapter/types';

export type GraphTabKey = 'detail' | 'graph';

export interface GraphTabProps {
  center: GraphCenter;
  creatable: CreateKind[];
  activeTab: GraphTabKey;
  onTabChange: (tab: GraphTabKey) => void;
  detailLabel?: string;
  graphLabel?: string;
  bare?: boolean;
}

export function GraphTab({
  center,
  creatable,
  activeTab,
  onTabChange,
  detailLabel = '详情',
  graphLabel = '🕸️ 关系图',
  bare = false,
}: GraphTabProps) {
  const navigate = useNavigate();
  const [visibleTypes, setVisibleTypes] = useState<ReadonlySet<EntityGraphNodeType>>(
    () => loadVisibleTypes(center)
  );
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  useEffect(() => {
    persistVisibleTypes(center, visibleTypes);
  }, [center, visibleTypes]);

  useEffect(() => {
    if (activeTab === 'graph') {
      emit('graph_tab_open', {
        entity_type: center.type,
        entity_id: center.id,
        source: 'tab',
      });
    }
  }, [activeTab, center]);

  const onNeighborOpen = (n: EntityGraphNode) => {
    emit('graph_node_click', {
      entity_type: n.entity_type,
      center_type: center.type,
      action: 'detail',
    });
    navigate(detailHrefFromNode(n));
  };

  const onNeighborDrill = (n: EntityGraphNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!['contact', 'project', 'event', 'action', 'note', 'interaction'].includes(n.entity_type)) return;
    emit('graph_node_click', {
      entity_type: n.entity_type,
      center_type: center.type,
      action: 'drill',
    });
    navigate(`/graph/${n.entity_type}/${n.id}`);
  };

  return (
    <>
      {!bare && (
        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: 0,
            borderBottom: '1px solid #e2e8f0',
            marginBottom: 16,
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'detail'}
            data-testid={`${center.type}-detail-tab`}
            onClick={() => onTabChange('detail')}
            style={tabStyle(activeTab === 'detail')}
          >
            {detailLabel}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'graph'}
            data-testid={`${center.type}-graph-tab`}
            onClick={() => onTabChange('graph')}
            style={tabStyle(activeTab === 'graph')}
          >
            {graphLabel}
          </button>
        </div>
      )}

      {activeTab === 'graph' && (
        <section className="section" style={{ marginTop: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, color: '#64748b' }}>筛选类型:</span>
            <button
              type="button"
              data-testid={`${center.type}-filter-all`}
              onClick={() => setVisibleTypes(new Set(ALL_TYPES))}
              disabled={visibleTypes.size === ALL_TYPES.length}
              style={bulkBtnStyle(visibleTypes.size === ALL_TYPES.length)}
            >
              全选
            </button>
            <button
              type="button"
              data-testid={`${center.type}-filter-none`}
              onClick={() => setVisibleTypes(new Set())}
              disabled={visibleTypes.size === 0}
              style={bulkBtnStyle(visibleTypes.size === 0)}
            >
              全不选
            </button>
            {ALL_TYPES.map((t) => {
              const meta = TYPE_META[t];
              const checked = visibleTypes.has(t);
              return (
                <label
                  key={t}
                  data-testid={`${center.type}-filter-${t}`}
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
                    onChange={(e) => {
                      const next = new Set(visibleTypes);
                      if (e.target.checked) next.add(t);
                      else next.delete(t);
                      setVisibleTypes(next);
                    }}
                    style={{ margin: 0 }}
                  />
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                </label>
              );
            })}
            {creatable.length > 0 && (
              <button
                type="button"
                data-testid={`${center.type}-quick-create-open`}
                onClick={() => setShowQuickCreate(true)}
                style={{ marginLeft: 'auto', padding: '6px 12px' }}
                className="btn btn-primary"
              >
                + 新建
              </button>
            )}
          </div>
          <EntityGraph
            centerType={center.type}
            centerId={center.id}
            visibleTypes={visibleTypes}
            onNeighborOpen={onNeighborOpen}
            onNeighborDrill={onNeighborDrill}
            onQuickCreate={creatable.length > 0 ? () => setShowQuickCreate(true) : undefined}
          />
          <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
            单击节点 = 打开详情页;↗ = 以此节点为中心重画图;中央 + = 新建并关联。
            超过 {GRAPH_NODE_CAP} 个节点的关联会被截断,需要更多请到「完整图」全屏查看。
          </div>
        </section>
      )}

      {showQuickCreate && (
        <GraphQuickCreateModal
          center={center}
          creatable={creatable}
          onClose={() => setShowQuickCreate(false)}
        />
      )}
    </>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    border: 'none',
    background: active ? '#fff' : 'transparent',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    color: active ? '#2563eb' : '#64748b',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontSize: 14,
    marginBottom: -1,
  };
}

function bulkBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '3px 8px',
    fontSize: 12,
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    background: disabled ? '#f1f5f9' : '#fff',
    color: disabled ? '#94a3b8' : '#475569',
    cursor: disabled ? 'default' : 'pointer',
  };
}

function storageKey(center: GraphCenter): string {
  return `weavine:${center.type}-graph-filter:v1`;
}

function loadVisibleTypes(center: GraphCenter): ReadonlySet<EntityGraphNodeType> {
  if (typeof window === 'undefined') return new Set(ALL_TYPES);
  try {
    const raw = window.localStorage.getItem(storageKey(center));
    if (!raw) return new Set(ALL_TYPES);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set(ALL_TYPES);
    return new Set(arr.filter((t) => ALL_TYPES.includes(t as EntityGraphNodeType)) as EntityGraphNodeType[]);
  } catch {
    return new Set(ALL_TYPES);
  }
}

function persistVisibleTypes(center: GraphCenter, set: ReadonlySet<EntityGraphNodeType>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(center), JSON.stringify(Array.from(set)));
  } catch {
    // localStorage may be full or disabled (private mode); silently drop.
  }
}

function detailHrefFromNode(n: EntityGraphNode): string {
  switch (n.entity_type) {
    case 'contact': return `/contacts/${n.id}`;
    case 'project': return `/projects/${n.id}`;
    case 'event': return `/events/${n.id}`;
    case 'action': return `/actions/${n.id}`;
    case 'note': return `/notes/${n.id}`;
    case 'interaction': return `/interactions/${n.id}`;
    default: return '/';
  }
}
