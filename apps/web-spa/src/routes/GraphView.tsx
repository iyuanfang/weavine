import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '../components/PageHeader';
import { EntityGraph, TYPE_META } from '../components/EntityGraph';
import { useAdapter } from '../lib/adapter';
import { emit } from '../lib/telemetry';
import type { EntityGraphNode, EntityGraphNodeType } from '../lib/adapter/types';

const SUPPORTED_CENTERS: EntityGraphNodeType[] = [
  'contact',
  'project',
  'event',
  'action',
  'note',
  'interaction',
];

interface Crumb {
  type: EntityGraphNodeType;
  id: string;
  label: string;
}

function detailHref(type: EntityGraphNodeType, id: string): string {
  switch (type) {
    case 'contact': return `/contacts/${id}`;
    case 'project': return `/projects/${id}`;
    case 'event': return `/events/${id}`;
    case 'action': return `/actions/${id}`;
    case 'note': return `/notes/${id}`;
    case 'interaction': return `/interactions/${id}`;
    default: return '/';
  }
}

export function GraphView() {
  const params = useParams() as { entityType: string; entityId: string };
  const adapter = useAdapter();
  const navigate = useNavigate();

  const centerType: EntityGraphNodeType | null = SUPPORTED_CENTERS.includes(
    params.entityType as EntityGraphNodeType
  )
    ? (params.entityType as EntityGraphNodeType)
    : null;

  const [history, setHistory] = useState<Crumb[]>([]);
  const lastCenterKey = useRef<string>('');

  const graphQuery = useQuery({
    queryKey: ['entity-graph', centerType, params.entityId],
    queryFn: () => (centerType ? adapter.graph.get(centerType, params.entityId) : null),
    enabled: centerType !== null,
  });

  useEffect(() => {
    if (!graphQuery.data) return;
    const center = graphQuery.data.nodes.find((n) => n.is_center);
    if (!center) return;
    const key = `${center.entity_type}:${center.id}`;
    if (key === lastCenterKey.current) return;
    lastCenterKey.current = key;
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.type === center.entity_type && last.id === center.id) return prev;
      return [...prev, { type: center.entity_type, id: center.id, label: center.label }];
    });
  }, [graphQuery.data]);

  useEffect(() => {
    if (centerType) {
      emit('graph_tab_open', {
        entity_type: centerType,
        entity_id: params.entityId,
        source: 'route',
      });
    }
  }, [centerType, params.entityId]);

  if (!centerType) {
    return (
      <div className="page">
        <div className="error-banner">
          不支持的实体类型:{params.entityType}。仅支持 {SUPPORTED_CENTERS.join(', ')}。
        </div>
      </div>
    );
  }

  const center = graphQuery.data?.nodes.find((n) => n.is_center);

  const onNeighborOpen = (n: EntityGraphNode) => {
    emit('graph_node_click', {
      entity_type: n.entity_type,
      center_type: centerType,
      action: 'detail',
    });
    navigate(detailHref(n.entity_type, n.id));
  };

  const onNeighborDrill = (n: EntityGraphNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!SUPPORTED_CENTERS.includes(n.entity_type)) return;
    emit('graph_node_click', {
      entity_type: n.entity_type,
      center_type: centerType,
      action: 'drill',
    });
    navigate(`/graph/${n.entity_type}/${n.id}`);
  };

  const jumpTo = (c: Crumb, idx: number) => {
    const next = history.slice(0, idx + 1);
    setHistory(next);
    navigate(`/graph/${c.type}/${c.id}`);
  };

  const clearHistory = () => setHistory([]);

  return (
    <div className="page">
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            🕸️ {center?.label ?? '(加载中)'} · {TYPE_META[centerType].label}关联图
          </span>
        }
        subtitle={
          <span>
            {graphQuery.data?.nodes.length ?? 0} 个节点 · {graphQuery.data?.edges.length ?? 0} 条边
            {center && (
              <>
                {' · '}
                <Link to={detailHref(centerType, params.entityId)}>
                  ← 返回 {TYPE_META[centerType].label}详情
                </Link>
              </>
            )}
          </span>
        }
      />

      {history.length > 1 && (
        <nav
          className="card"
          style={{ padding: '8px 12px', marginBottom: 12 }}
          data-testid="graph-breadcrumb"
        >
          <span style={{ marginRight: 8, color: '#64748b', fontSize: 13 }}>路径:</span>
          {history.map((c, i) => (
            <span key={`${c.type}:${c.id}:${i}`}>
              <button
                type="button"
                onClick={() => jumpTo(c, i)}
                className="btn-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
              >
                {TYPE_META[c.type].icon} {c.label}
              </button>
              {i < history.length - 1 && <span style={{ color: '#94a3b8' }}> › </span>}
            </span>
          ))}
          <button
            type="button"
            onClick={clearHistory}
            className="btn-link"
            style={{
              marginLeft: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#ef4444',
            }}
          >
            清空
          </button>
        </nav>
      )}

      <EntityGraph
        centerType={centerType}
        centerId={params.entityId}
        onNeighborOpen={onNeighborOpen}
        onNeighborDrill={onNeighborDrill}
      />

      <div className="card" style={{ padding: 12, marginTop: 12, fontSize: 12, color: '#64748b' }}>
        <strong>提示:</strong>单击节点 = 打开详情页;节点右上角 ↗ = 以此节点为中心重新画图(钻取);
        顶部面包屑可跳回任意层级。
      </div>
    </div>
  );
}

export default GraphView;
