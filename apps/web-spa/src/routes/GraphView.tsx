import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import type { EntityGraphNode, EntityGraphNodeType } from '../lib/adapter/types';

const RING_RADIUS = 220;
const NODE_R = 32;
const CENTER_R = 44;
const W = 800;
const H = 600;

interface Crumb {
  type: EntityGraphNodeType;
  id: string;
  label: string;
}

const TYPE_META: Record<EntityGraphNodeType, { icon: string; color: string; label: string }> = {
  contact: { icon: '👤', color: '#2563eb', label: '联系人' },
  project: { icon: '📁', color: '#7c3aed', label: '项目' },
  event: { icon: '📅', color: '#10b981', label: '事件' },
  action: { icon: '✅', color: '#f59e0b', label: '动作' },
  note: { icon: '📝', color: '#ec4899', label: '笔记' },
  tag: { icon: '🏷️', color: '#64748b', label: '标签' },
  interaction: { icon: '💬', color: '#0ea5e9', label: '互动' },
};

const SUPPORTED_CENTERS: EntityGraphNodeType[] = ['contact', 'project', 'event', 'action', 'note'];

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

  const centerType: EntityGraphNodeType | null = useMemo(() => {
    return SUPPORTED_CENTERS.includes(params.entityType as EntityGraphNodeType)
      ? (params.entityType as EntityGraphNodeType)
      : null;
  }, [params.entityType]);

  const [history, setHistory] = useState<Crumb[]>([]);
  const lastCenterKey = useRef<string>('');

  const graphQuery = useQuery({
    queryKey: ['entity-graph', centerType, params.entityId],
    queryFn: () => adapter.graph.get(centerType!, params.entityId),
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

  if (!centerType) {
    return (
      <div className="page">
        <div className="error-banner">
          不支持的实体类型：{params.entityType}。仅支持 {SUPPORTED_CENTERS.join(', ')}。
        </div>
      </div>
    );
  }

  if (graphQuery.isLoading) {
    return <div className="loading">加载中…</div>;
  }
  if (graphQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载失败：{String(graphQuery.error)}</div>
      </div>
    );
  }

  const graph = graphQuery.data!;
  const center = graph.nodes.find((n) => n.is_center);
  const others = graph.nodes.filter((n) => !n.is_center);

  const placedAt: Record<string, { x: number; y: number }> = {};
  const cx = W / 2;
  const cy = H / 2;
  others.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(others.length, 1);
    placedAt[`${n.entity_type}:${n.id}`] = {
      x: cx + RING_RADIUS * Math.cos(a),
      y: cy + RING_RADIUS * Math.sin(a),
    };
  });

  function onNeighborOpen(n: EntityGraphNode) {
    navigate(detailHref(n.entity_type, n.id));
  }

  function onNeighborDrill(n: EntityGraphNode, e: React.MouseEvent) {
    e.stopPropagation();
    if (!SUPPORTED_CENTERS.includes(n.entity_type)) return;
    navigate(`/graph/${n.entity_type}/${n.id}`);
  }

  function jumpTo(c: Crumb, idx: number) {
    const next = history.slice(0, idx + 1);
    setHistory(next);
    navigate(`/graph/${c.type}/${c.id}`);
  }

  function clearHistory() {
    setHistory([]);
  }

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
            {graph.nodes.length} 个节点 · {graph.edges.length} 条边
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
        <nav className="card" style={{ padding: '8px 12px', marginBottom: 12 }} data-testid="graph-breadcrumb">
          <span style={{ marginRight: 8, color: '#64748b', fontSize: 13 }}>路径：</span>
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
            style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
          >
            清空
          </button>
        </nav>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', background: 'linear-gradient(180deg,#fafbff,#f3f4f8)' }}
          data-testid="graph-svg"
        >
          <circle cx={cx} cy={cy} r={RING_RADIUS + 30} fill="none" stroke="#e5e7eb" strokeDasharray="2 4" />

          {graph.edges.map((e, i) => {
            const fromKey = `${e.from_type}:${e.from_id}`;
            const toKey = `${e.to_type}:${e.to_id}`;
            const ax = e.from_id === params.entityId && e.from_type === centerType
              ? cx : placedAt[fromKey]?.x ?? cx;
            const ay = e.from_id === params.entityId && e.from_type === centerType
              ? cy : placedAt[fromKey]?.y ?? cy;
            const bx = e.to_id === params.entityId && e.to_type === centerType
              ? cx : placedAt[toKey]?.x ?? cx;
            const by = e.to_id === params.entityId && e.to_type === centerType
              ? cy : placedAt[toKey]?.y ?? cy;
            return (
              <line
                key={i}
                x1={ax}
                y1={ay}
                x2={bx}
                y2={by}
                stroke="#94a3b8"
                strokeWidth={1.5}
                opacity={0.6}
              />
            );
          })}

          {center && (
            <g data-testid="graph-center">
              <circle cx={cx} cy={cy} r={CENTER_R} fill={TYPE_META[centerType].color} stroke="#1e293b" strokeWidth={2} />
              <text x={cx} y={cy + 5} fontSize="14" fontWeight={700} fill="#fff" textAnchor="middle">
                {TYPE_META[centerType].icon}
              </text>
              <text x={cx} y={cy + CENTER_R + 16} fontSize="12" fontWeight={600} fill="#1e293b" textAnchor="middle">
                {truncate(center.label, 18)}
              </text>
            </g>
          )}

          {others.length === 0 && (
            <text x={cx} y={cy + RING_RADIUS + 70} fontSize="13" fill="#94a3b8" textAnchor="middle">
              暂无关联
            </text>
          )}

          {others.map((n) => {
            const key = `${n.entity_type}:${n.id}`;
            const p = placedAt[key];
            if (!p) return null;
            const meta = TYPE_META[n.entity_type];
            const isSupported = SUPPORTED_CENTERS.includes(n.entity_type);
            const openHandler = () => onNeighborOpen(n);
            return (
              <g
                key={key}
                data-testid={`graph-node-${n.entity_type}-${n.id}`}
                style={{ cursor: 'pointer' }}
                onClick={openHandler}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R + 6}
                  fill="transparent"
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R}
                  fill="#fff"
                  stroke={meta.color}
                  strokeWidth={2}
                  pointerEvents="none"
                />
                <text x={p.x} y={p.y + 5} fontSize="18" textAnchor="middle" pointerEvents="none">
                  {meta.icon}
                </text>
                <text
                  x={p.x}
                  y={p.y + NODE_R + 14}
                  fontSize="11"
                  fill="#1e293b"
                  textAnchor="middle"
                  pointerEvents="none"
                  style={{ paintOrder: 'stroke', stroke: '#fafbff', strokeWidth: 3 }}
                >
                  {truncate(n.label, 14)}
                </text>
                {isSupported && (
                  <g
                    data-testid={`graph-node-${n.entity_type}-${n.id}-drill`}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => onNeighborDrill(n, e)}
                  >
                    <circle
                      cx={p.x + NODE_R - 4}
                      cy={p.y - NODE_R + 4}
                      r={11}
                      fill={meta.color}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                    <text
                      x={p.x + NODE_R - 4}
                      y={p.y - NODE_R + 8}
                      fontSize="14"
                      fontWeight={700}
                      fill="#fff"
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      ⊕
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="card" style={{ padding: 12, marginTop: 12, fontSize: 12, color: '#64748b' }}>
        <strong>提示：</strong>单击节点 = 打开详情页；节点右上角 ⊕ = 以此节点为中心重新画图（钻取）；
        顶部面包屑可跳回任意层级；标签节点（🏷️）不可钻取。
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export default GraphView;