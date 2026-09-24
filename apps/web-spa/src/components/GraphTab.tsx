import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ALL_TYPES, GRAPH_NODE_CAP, TYPE_META, type GraphCenter } from './EntityGraph';
import { GraphQuickCreateModal, creatableForCenter, type CreateKind } from './GraphQuickCreateModal';
import { emit } from '../lib/telemetry';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
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
  const [menu, setMenu] = useState<{ node: EntityGraphNode; x: number; y: number } | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  const adapter = useAdapter();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const graphQuery = useQuery({
    queryKey: ['entity-graph', center.type, center.id],
    queryFn: () => adapter.graph.get(center.type, center.id),
    // bare mode (GraphView route) renders only the graph — always fetch.
    enabled: bare || tabHovered || activeTab === 'graph',
  });
  const availableTypes = useMemo<ReadonlySet<EntityGraphNodeType>>(() => {
    const set = new Set<EntityGraphNodeType>();
    for (const n of graphQuery.data?.nodes ?? []) {
      if (!n.is_center && TYPE_META[n.entity_type]) set.add(n.entity_type);
    }
    return set;
  }, [graphQuery.data]);

  useEffect(() => {
    persistVisibleTypes(center, visibleTypes);
  }, [center.type, center.id, visibleTypes]);

  useEffect(() => {
    if (activeTab === 'graph') {
      emit('graph_tab_open', {
        entity_type: center.type,
        entity_id: center.id,
        source: 'tab',
      });
    }
  }, [activeTab, center.type, center.id]);

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

  // Only show create options that produce a meaningful link back to the
  // center. Without this filter the modal would open with no options (note
  // centers, etc.) and the + 新建 button would be misleading.
  const effectiveCreatable = useMemo(
    () => creatableForCenter(center.type, creatable),
    [center.type, creatable],
  );

  // ── Unlink (断开关联) ────────────────────────────────────
  // Every edge is backed by a real relation (FK or link table) except
  // event↔action, which is derived through interactions — that pair gets no
  // minus. Unlinking NEVER deletes the entity.
  const canUnlinkNode = useCallback(
    (n: EntityGraphNode) => {
      const pair = `${center.type}:${n.entity_type}`;
      return [
        'contact:event', 'contact:action', 'contact:project', 'contact:note', 'contact:interaction',
        'project:contact', 'project:event', 'project:action', 'project:note',
        'event:contact', 'event:interaction', 'event:note',
        'action:contact', 'action:interaction', 'action:note',
        'interaction:contact', 'interaction:event', 'interaction:action', 'interaction:note',
        'note:contact', 'note:project', 'note:event', 'note:action', 'note:interaction',
      ].includes(pair);
    },
    [center.type],
  );

  const removeNoteLink = useCallback(
    async (uid: string, noteId: string, entityType: string, entityId: string) => {
      const note = await adapter.notes.get(uid, noteId);
      if (!note) return;
      const links = await adapter.notes.listEntityLinks(uid, noteId);
      await adapter.notes.update(uid, noteId, {
        id: noteId,
        title: note.title,
        body: note.body,
        entity_links: links.filter(
          (l) => !(l.entity_type === entityType && l.entity_id === entityId),
        ),
      });
    },
    [adapter],
  );

  // Form semantics: contact_id mirrors the first participant.
  const removeEventParticipant = useCallback(
    async (eventId: string, contactId: string) => {
      const ev = await adapter.events.get(eventId);
      if (!ev) return;
      const rest = (ev.participants ?? [])
        .map((p) => p.contact_id)
        .filter((cid) => cid !== contactId);
      // Server PUT skips participant_contact_ids when the JSON value is
      // null — clearing the list requires an explicit [].
      await adapter.events.update({
        id: eventId,
        participant_contact_ids: rest,
        contact_id: rest[0] ?? null,
      });
    },
    [adapter],
  );

  const unlinkNeighbor = useCallback(
    async (n: EntityGraphNode) => {
      if (!userId || unlinking) return;
      const uid = userId;
      setUnlinking(true);
      try {
        if (n.entity_type === 'note') {
          // note↔anything is a note_entity link; the note keeps its body.
          await removeNoteLink(uid, n.id, center.type, center.id);
        } else if (center.type === 'contact' && n.entity_type === 'event') {
          await removeEventParticipant(n.id, center.id);
        } else if (center.type === 'event' && n.entity_type === 'contact') {
          await removeEventParticipant(center.id, n.id);
        } else if (center.type === 'contact' && n.entity_type === 'project') {
          await adapter.projectContacts.remove(n.id, center.id);
        } else if (center.type === 'project' && n.entity_type === 'contact') {
          await adapter.projectContacts.remove(center.id, n.id);
        } else if (center.type === 'project' && n.entity_type === 'event') {
          await adapter.events.update({ id: n.id, project_id: null });
        } else if (center.type === 'event' && n.entity_type === 'project') {
          await adapter.events.update({ id: center.id, project_id: null });
        } else if (n.entity_type === 'interaction') {
          const field = center.type === 'event' ? 'event_id'
            : center.type === 'action' ? 'action_id'
            : 'contact_id';
          await adapter.interactions.update({ id: n.id, [field]: null });
        } else if (center.type === 'interaction') {
          const field = n.entity_type === 'event' ? 'event_id'
            : n.entity_type === 'action' ? 'action_id'
            : 'contact_id';
          await adapter.interactions.update({ id: center.id, [field]: null });
        } else if (n.entity_type === 'action') {
          // action neighbor of a contact/project center: clear its FK
          const field = center.type === 'contact' ? 'contact_id' : 'project_id';
          await adapter.actions.update({ id: n.id, [field]: null });
        } else if (center.type === 'action' && n.entity_type === 'contact') {
          await adapter.actions.update({ id: center.id, contact_id: null });
        } else {
          throw new Error('该关联不支持断开');
        }
        queryClient.invalidateQueries({ queryKey: ['entity-graph', center.type, center.id] });
      } catch (e) {
        alert(`断开关联失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setUnlinking(false);
      }
    },
    [adapter, center.id, center.type, queryClient, removeEventParticipant, removeNoteLink, unlinking, userId],
  );

  const onNodeMenu = useCallback(
    (node: EntityGraphNode, at: { x: number; y: number }) => setMenu({ node, x: at.x, y: at.y }),
    [],
  );

  const handleQuickCreate = useCallback(() => setShowQuickCreate(true), []);

  const showEmptyCta =
    !!graphQuery.data && availableTypes.size === 0 && effectiveCreatable.length > 0;

  return (
    <>
      {!bare && (
        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: 0,
            borderBottom: '1px solid #e2e8f0',
            marginBottom: 12,
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

      {(bare || activeTab === 'graph') && (
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
            {effectiveCreatable.length > 0 && (
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
              onQuickCreate={effectiveCreatable.length > 0 ? handleQuickCreate : undefined}
              onUnlink={unlinkNeighbor}
              canUnlink={canUnlinkNode}
              onNodeMenu={onNodeMenu}
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
                + 添加{TYPE_META[effectiveCreatable[0]].label}
              </button>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
            单击节点 = 查看该节点的关系图。
            {effectiveCreatable.length > 0 && '点击 + 新建按钮即可在此添加关联实体。'}
            悬停节点点 − 断开关联（不删除实体）；右键 / 长按节点打开操作菜单。
            超过 {GRAPH_NODE_CAP} 个节点的关联会被截断。
          </div>
        </section>
      )}

      {menu && (
        <GraphNodeMenu
          node={menu.node}
          at={{ x: menu.x, y: menu.y }}
          canUnlink={canUnlinkNode(menu.node)}
          unlinking={unlinking}
          onOpenDetail={() => {
            setMenu(null);
            navigate(detailHref(menu.node));
          }}
          onUnlink={() => {
            void unlinkNeighbor(menu.node);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
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

function detailHref(n: EntityGraphNode): string {
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

/** Right-click / long-press menu for a graph neighbor.
 *  Deliberately offers no delete: entities are deleted from their detail
 *  page, never from the canvas. */
function GraphNodeMenu({
  node,
  at,
  canUnlink,
  unlinking,
  onOpenDetail,
  onUnlink,
  onClose,
}: {
  node: EntityGraphNode;
  at: { x: number; y: number };
  canUnlink: boolean;
  unlinking: boolean;
  onOpenDetail: () => void;
  onUnlink: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = TYPE_META[node.entity_type];
  const left = Math.min(at.x, window.innerWidth - 190);
  const top = Math.min(at.y, window.innerHeight - 150);

  return (
    <div
      data-testid="graph-node-menu"
      style={{ position: 'fixed', inset: 0, zIndex: 1100 }}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        style={{
          position: 'fixed',
          left,
          top,
          width: 180,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          boxShadow: '0 10px 25px rgba(15,23,42,0.15)',
          padding: 4,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '6px 10px', fontSize: 12, color: '#64748b', fontWeight: 600 }}>
          {meta.icon} {node.label.slice(0, 12)}
        </div>
        {[
          { label: '打开详情', fn: onOpenDetail, disabled: false },
          {
            label: unlinking ? '断开中…' : '断开关联',
            fn: onUnlink,
            disabled: !canUnlink || unlinking,
            title: canUnlink ? '解除与当前实体的关联，不删除该实体' : '该关联由其它记录推导，无法直接断开',
          },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            title={'title' in item ? item.title : undefined}
            onClick={item.fn}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '7px 10px',
              border: 'none',
              background: 'transparent',
              borderRadius: 6,
              cursor: item.disabled ? 'default' : 'pointer',
              fontSize: 13,
              color: item.disabled ? '#94a3b8' : '#0f172a',
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
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
