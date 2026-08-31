import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ALL_TYPES, GRAPH_NODE_CAP, TYPE_META, type GraphCenter } from './EntityGraph';
import { GraphQuickCreateModal, type CreateKind } from './GraphQuickCreateModal';
import { emit } from '../lib/telemetry';
import { useAdapter } from '../lib/adapter';
import type { EntityGraphNode, EntityGraphNodeType } from '../lib/adapter/types';

const EntityGraph = lazy(() => import('./EntityGraph').then((m) => ({ default: m.EntityGraph })));

export type GraphTabKey = 'detail' | 'graph';

export interface GraphTabProps {
  center: GraphCenter;
  creatable?: CreateKind[];
  detailLabel?: string;
  graphLabel?: string;
  bare?: boolean;
}

export function GraphTab({
  center,
  creatable = [],
  detailLabel = '详情',
  graphLabel = '🕸️ 关系图',
  bare = false,
}: GraphTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: GraphTabKey = searchParams.get('tab') === 'graph' ? 'graph' : 'detail';
  const onTabChange = (tab: GraphTabKey) => {
    setSearchParams(tab === 'graph' ? { tab: 'graph' } : {});
  };
  const [visibleTypes, setVisibleTypes] = useState<ReadonlySet<EntityGraphNodeType>>(
    () => loadVisibleTypes(center)
  );
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [tabHovered, setTabHovered] = useState(false);

  const adapter = useAdapter();
  const graphQuery = useQuery({
    queryKey: ['entity-graph', center.type, center.id],
    queryFn: () => adapter.graph.get(center.type, center.id),
    enabled: tabHovered || activeTab === 'graph',
  });
  const availableTypes = useMemo<ReadonlySet<EntityGraphNodeType>>(() => {
    const set = new Set<EntityGraphNodeType>();
    for (const n of graphQuery.data?.nodes ?? []) {
      if (!n.is_center) set.add(n.entity_type);
    }
    return set;
  }, [graphQuery.data]);

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

  const onNeighborOpen = useCallback(
    (n: EntityGraphNode) => {
      emit('graph_node_click', {
        entity_type: n.entity_type,
        center_type: center.type,
        action: 'graph',
      });
      navigate(graphHrefFromNode(n));
    },
    [center.type, navigate]
  );

  const handleQuickCreate = useCallback(() => setShowQuickCreate(true), []);

  const showEmptyCta =
    !!graphQuery.data && availableTypes.size === 0 && creatable.length > 0;

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
            onMouseEnter={() => setTabHovered(true)}
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
            {availableTypes.size > 1 && (
              <>
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
              </>
            )}
            {ALL_TYPES.filter((t) => availableTypes.has(t)).map((t) => {
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
                onClick={handleQuickCreate}
                style={{ marginLeft: 'auto', padding: '6px 12px' }}
                className="btn btn-primary"
              >
                + 新建
              </button>
            )}
          </div>
          <Suspense fallback={<div style={{ padding: 16, color: '#64748b' }}>加载中…</div>}>
            <EntityGraph
              centerType={center.type}
              centerId={center.id}
              visibleTypes={visibleTypes}
              onNeighborOpen={onNeighborOpen}
              onQuickCreate={creatable.length > 0 ? handleQuickCreate : undefined}
            />
          </Suspense>
          {showEmptyCta && (
            <div
              style={{
                marginTop: 12,
                padding: 16,
                border: '1px dashed #cbd5e1',
                borderRadius: 8,
                textAlign: 'center',
                background: '#f8fafc',
              }}
            >
              <div style={{ fontSize: 14, color: '#475569', marginBottom: 8 }}>
                暂无关联 — 添加第一条
              </div>
              <button
                type="button"
                data-testid={`${center.type}-empty-create-cta`}
                onClick={handleQuickCreate}
                className="btn btn-primary"
                style={{ padding: '6px 12px' }}
              >
                + 添加{TYPE_META[creatable[0]].label}
              </button>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
            单击节点 = 查看该节点的关系图。
            {creatable.length > 0 && '点击 + 新建按钮即可在此添加关联实体。'}
            超过 {GRAPH_NODE_CAP} 个节点的关联会被截断。
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

function graphHrefFromNode(n: EntityGraphNode): string {
  switch (n.entity_type) {
    case 'contact': return `/contacts/${n.id}?tab=graph`;
    case 'project': return `/projects/${n.id}?tab=graph`;
    case 'event': return `/events/${n.id}?tab=graph`;
    case 'action': return `/actions/${n.id}?tab=graph`;
    case 'note': return `/notes/${n.id}?tab=graph`;
    case 'interaction': return `/interactions/${n.id}?tab=graph`;
    default: return '/';
  }
}
