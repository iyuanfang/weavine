import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import type { EntityGraphNode, EntityGraphNodeType } from '../lib/adapter/types';

const RING_RADII = [150, 240, 330] as const;
const NODE_R = 32;
const CENTER_R = 44;
const W = 800;
const H = 760;

const RING_LEVEL: Record<EntityGraphNodeType, 0 | 1 | 2> = {
  interaction: 0,
  contact: 1,
  event: 1,
  action: 1,
  project: 2,
  note: 2,
};

interface Crumb {
  type: EntityGraphNodeType;
  id: string;
  label: string;
}

const TYPE_META: Record<EntityGraphNodeType, { icon: string; color: string; label: string }> = {
  contact: { icon: '👤', color: '#2563eb', label: '联系人' },
  project: { icon: '📁', color: '#7c3aed', label: '项目' },
  event: { icon: '📅', color: '#10b981', label: '日程' },
  action: { icon: '✅', color: '#f59e0b', label: '待办' },
  note: { icon: '📝', color: '#ec4899', label: '笔记' },
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
  // Drop nodes whose entity_type isn't in TYPE_META. The server can return
  // "tag" (server SUPPORTED_ENTITY_TYPES includes it) but the UI redesign
  // intentionally drops tag nodes — see commit 2e7bbe4. Without this filter,
  // TYPE_META[n.entity_type] is undefined and `meta.color` crashes the page.
  const others = graph.nodes.filter(
    (n) => !n.is_center && TYPE_META[n.entity_type] !== undefined
  );

  const placedAt: Record<string, { x: number; y: number }> = {};
  const cx = W / 2;
  const cy = H / 2;
  const byRing: EntityGraphNode[][] = [[], [], []];
  others.forEach((n) => {
    const lvl = RING_LEVEL[n.entity_type] ?? 1;
    byRing[lvl].push(n);
  });
  byRing.forEach((nodes, ringIdx) => {
    if (nodes.length === 0) return;
    const R = RING_RADII[ringIdx];
    const offset = ringIdx * (Math.PI / Math.max(nodes.length, 1));
    nodes.forEach((n, i) => {
      const a = (2 * Math.PI * i) / nodes.length + offset;
      placedAt[`${n.entity_type}:${n.id}`] = {
        x: cx + R * Math.cos(a),
        y: cy + R * Math.sin(a),
      };
    });
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
          <circle cx={cx} cy={cy} r={RING_RADII[2] + 30} fill="none" stroke="#e5e7eb" strokeDasharray="2 4" />
          {RING_RADII.map((R, i) => (
            <circle
              key={`ring-${i}`}
              cx={cx}
              cy={cy}
              r={R}
              fill="none"
              stroke="#e5e7eb"
              strokeDasharray={i === 2 ? '2 4' : '1 6'}
              opacity={0.6}
            />
          ))}

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
            const dx = bx - ax;
            const dy = by - ay;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const bow = ((i * 7) % 11) - 5;
            const mx = (ax + bx) / 2 + nx * bow;
            const my = (ay + by) / 2 + ny * bow;
            const stroke = TYPE_META[e.to_type]?.color ?? '#94a3b8';
            return (
              <path
                key={i}
                d={`M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`}
                stroke={stroke}
                strokeWidth={1.5}
                fill="none"
                opacity={0.55}
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
            <text x={cx} y={cy + RING_RADII[2] + 70} fontSize="13" fill="#94a3b8" textAnchor="middle">
              暂无关联
            </text>
          )}

          {others.map((n) => {
            const key = `${n.entity_type}:${n.id}`;
            const p = placedAt[key];
            if (!p) return null;
            const meta = TYPE_META[n.entity_type];
            if (!meta) return null;
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
                      ↗
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="card" style={{ padding: 12, marginTop: 12, fontSize: 12, color: '#64748b' }}>
        <strong>提示：</strong>单击节点 = 打开详情页；节点右上角 ↗ = 以此节点为中心重新画图（钻取）；
        顶部面包屑可跳回任意层级。
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export default GraphView;