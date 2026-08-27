import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import type { EntityGraphNode, EntityGraphNodeType } from '../lib/adapter/types';

const W = 900;
const H = 820;
const R_INNER = 110;
const R_OUTER = 320;
const NODE_R = 32;
const CENTER_R = 44;
const SECTOR_GAP_DEG = 2;

// Stable, semantic ordering of entity types around the canvas.
// Starts at 12-o'clock (top) and proceeds clockwise.
const TYPE_ORDER: EntityGraphNodeType[] = [
  'interaction',
  'event',
  'action',
  'note',
  'project',
];

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

  const cx = W / 2;
  const cy = H / 2;
  const placedAt: Record<string, { x: number; y: number }> = {};
  const sectors: Array<{ type: EntityGraphNodeType; midAngle: number; count: number }> = [];

  if (others.length > 0) {
    // Group by entity_type using TYPE_ORDER priority, then any unknown types last.
    const byType = new Map<EntityGraphNodeType, EntityGraphNode[]>();
    for (const n of others) {
      const arr = byType.get(n.entity_type) ?? [];
      arr.push(n);
      byType.set(n.entity_type, arr);
    }
    const orderedTypes: EntityGraphNodeType[] = [
      ...TYPE_ORDER.filter((t) => byType.has(t)),
      ...[...byType.keys()].filter((t) => !TYPE_ORDER.includes(t)),
    ];

    const gapRad = (SECTOR_GAP_DEG * Math.PI) / 180;
    let cursor = -Math.PI / 2; // start at 12 o'clock, clockwise
    for (const t of orderedTypes) {
      const nodes = byType.get(t)!;
      const sweep = (nodes.length / others.length) * 2 * Math.PI;
      const startAngle = cursor + gapRad / 2;
      const endAngle = cursor + sweep - gapRad / 2;
      const midAngle = (startAngle + endAngle) / 2;

      // Cluster layout: same-type nodes form a tight multi-ring cluster so the
      // outermost node always sits at the sector midAngle (not at the sector
      // boundary), preventing overlap with the adjacent sector's outermost
      // node. Rings spiral inward with 50 px spacing (so center→node line
      // lengths differ noticeably). Angular spread is computed from slot count
      // and ring radius so neighbouring nodes never collide (min 70 px
      // center-to-center). Within a ring with 2+ nodes, alternating radial
      // jitter of ±8 px breaks visual monotony.
      const ringCapacity = (ring: number): number => {
        if (ring === 0) return 1;
        return Math.floor(ring / 2) + 2;
      };
      const minSpacing = NODE_R * 2 + 6; // 70 px center-to-center
      const clusterPos: Array<{ angle: number; radius: number }> = [];
      let placed = 0;
      let ring = 0;
      while (placed < nodes.length) {
        const cap = ringCapacity(ring);
        const slots = Math.min(cap, nodes.length - placed);
        const ringR = R_OUTER - ring * 50;
        if (slots === 1) {
          clusterPos.push({ angle: midAngle, radius: ringR });
        } else {
          // Spread = (slots-1) * minSpacing / ringR; ensures every gap ≥
          // minSpacing. Capped at 80% of the sector arc so the cluster stays
          // inside its wedge even when the sector is narrow.
          const spreadRad = Math.min(
            ((slots - 1) * minSpacing) / ringR,
            sweep * 0.8
          );
          for (let j = 0; j < slots; j++) {
            const t2 = j / (slots - 1);
            // Alternating ±8 px radial jitter so line lengths vary within the
            // same ring too.
            const jitter = j % 2 === 0 ? -8 : 8;
            clusterPos.push({
              angle: midAngle - spreadRad / 2 + spreadRad * t2,
              radius: ringR + jitter,
            });
          }
        }
        placed += slots;
        ring++;
      }

      nodes.forEach((n, i) => {
        const pos = clusterPos[i];
        placedAt[`${n.entity_type}:${n.id}`] = {
          x: cx + pos.radius * Math.cos(pos.angle),
          y: cy + pos.radius * Math.sin(pos.angle),
        };
      });
      sectors.push({ type: t, midAngle, count: nodes.length });
      cursor += sweep;
    }
  }

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
          <circle cx={cx} cy={cy} r={R_OUTER + 30} fill="none" stroke="#e5e7eb" strokeDasharray="2 4" opacity={0.4} />

          {sectors.map((s) => {
            const meta = TYPE_META[s.type];
            // Re-derive startAngle by walking back through the ordered list of sectors.
            let cursor = -Math.PI / 2;
            for (const t of sectors.map((x) => x.type)) {
              if (t === s.type) break;
              cursor += (sectors.find((x) => x.type === t)!.count / others.length) * 2 * Math.PI;
            }
            const gapRad = (SECTOR_GAP_DEG * Math.PI) / 180;
            const sweep = (s.count / others.length) * 2 * Math.PI;
            const startA = cursor + gapRad / 2;
            const endA = cursor + sweep - gapRad / 2;
            const x1 = cx + R_OUTER * Math.cos(startA);
            const y1 = cy + R_OUTER * Math.sin(startA);
            const x2 = cx + R_OUTER * Math.cos(endA);
            const y2 = cy + R_OUTER * Math.sin(endA);
            const xi1 = cx + R_INNER * Math.cos(startA);
            const yi1 = cy + R_INNER * Math.sin(startA);
            const xi2 = cx + R_INNER * Math.cos(endA);
            const yi2 = cy + R_INNER * Math.sin(endA);
            const largeArc = endA - startA > Math.PI ? 1 : 0;
            return (
              <path
                key={`wedge-${s.type}`}
                d={`M ${xi1} ${yi1} L ${x1} ${y1} A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${R_INNER} ${R_INNER} 0 ${largeArc} 0 ${xi1} ${yi1} Z`}
                fill={meta.color}
                fillOpacity={0.05}
                stroke="none"
                pointerEvents="none"
              />
            );
          })}

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
            const stroke = TYPE_META[e.to_type]?.color ?? '#94a3b8';
            return (
              <line
                key={i}
                x1={ax}
                y1={ay}
                x2={bx}
                y2={by}
                stroke={stroke}
                strokeWidth={1.5}
                opacity={0.5}
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

          {sectors.map((s) => {
            const meta = TYPE_META[s.type];
            const lr = R_OUTER + 30;
            const lx = cx + lr * Math.cos(s.midAngle);
            const ly = cy + lr * Math.sin(s.midAngle);
            const cosA = Math.cos(s.midAngle);
            const sinA = Math.sin(s.midAngle);
            const anchor = Math.abs(cosA) < 0.3 ? 'middle' : cosA > 0 ? 'start' : 'end';
            const dy = sinA > 0.5 ? 14 : sinA < -0.5 ? -6 : 4;
            return (
              <text
                key={`label-${s.type}`}
                x={lx}
                y={ly + dy}
                fontSize="12"
                fontWeight={600}
                fill="#1e293b"
                textAnchor={anchor}
                pointerEvents="none"
                style={{ paintOrder: 'stroke', stroke: '#fafbff', strokeWidth: 3 }}
              >
                {meta.icon} {meta.label} · {s.count}
              </text>
            );
          })}

          {others.length === 0 && (
            <text x={cx} y={cy + R_OUTER + 40} fontSize="13" fill="#94a3b8" textAnchor="middle">
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