import { useQuery } from '@tanstack/react-query';
import { memo, useCallback, useMemo, useState } from 'react';
import { useAdapter } from '../lib/adapter';
import type { EntityGraphNode, EntityGraphNodeType, EntityGraphResponse } from '../lib/adapter/types';

const W = 900;
const H = 600;
const CX = W / 2;
const CY = H / 2;
const R_INNER = 80;
const R_OUTER = 230;
const NODE_R = 28;
const CENTER_R = 44;
const SECTOR_GAP_DEG = 2;
const ringSpacing = 80;

export const GRAPH_NODE_CAP = 80;

export const TYPE_ORDER: EntityGraphNodeType[] = [
  'interaction',
  'event',
  'action',
  'note',
  'project',
];

export const TYPE_META: Record<EntityGraphNodeType, { icon: string; color: string; label: string }> = {
  contact: { icon: '👤', color: '#2563eb', label: '联系人' },
  project: { icon: '📁', color: '#7c3aed', label: '项目' },
  event: { icon: '📅', color: '#10b981', label: '日程' },
  action: { icon: '✅', color: '#f59e0b', label: '待办' },
  note: { icon: '📝', color: '#ec4899', label: '笔记' },
  interaction: { icon: '💬', color: '#0ea5e9', label: '互动' },
};

export const ALL_TYPES: EntityGraphNodeType[] = Object.keys(TYPE_META) as EntityGraphNodeType[];

export interface GraphCenter {
  type: EntityGraphNodeType;
  id: string;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export interface EntityGraphProps {
  centerType: EntityGraphNodeType;
  centerId: string;
  /**
   * If provided, only nodes of these types are rendered. If undefined,
   * every type is shown. Center node is always shown regardless.
   */
  visibleTypes?: ReadonlySet<EntityGraphNodeType>;
  /** Called when a neighbor node is single-clicked. */
  onNeighborOpen: (n: EntityGraphNode) => void;
  /**
   * Optional: if provided, a "+" badge is rendered on the center node
   * that triggers this callback when clicked.
   */
  onQuickCreate?: () => void;
  /** Render only the SVG (no error/loading chrome). Used by inline tab. */
  bare?: boolean;
}

export function EntityGraph({
  centerType,
  centerId,
  visibleTypes,
  onNeighborOpen,
  onQuickCreate,
  bare,
}: EntityGraphProps) {
  const adapter = useAdapter();

  const graphQuery = useQuery({
    queryKey: ['entity-graph', centerType, centerId],
    queryFn: () => adapter.graph.get(centerType, centerId),
  });

  const data = useMemo(() => {
    if (!graphQuery.data) return null;
    return applyFilterAndCap(graphQuery.data, visibleTypes);
  }, [graphQuery.data, visibleTypes]);

  if (!bare) {
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
  }

  if (!data) return null;

  return <GraphSvg data={data} onNeighborOpen={onNeighborOpen} onQuickCreate={onQuickCreate} />;
}

/**
 * Applies the type filter, drops tag nodes (which TYPE_META does not cover),
 * and caps total neighbors at GRAPH_NODE_CAP. Returned shape preserves the
 * original total count so the UI can show an overflow banner.
 */
function applyFilterAndCap(
  raw: EntityGraphResponse,
  visibleTypes: ReadonlySet<EntityGraphNodeType> | undefined
): EntityGraphResponse & { hidden_count: number; total_neighbors: number } {
  const center = raw.nodes.find((n) => n.is_center);
  const others = raw.nodes.filter(
    (n) =>
      !n.is_center &&
      TYPE_META[n.entity_type] !== undefined &&
      (visibleTypes === undefined || visibleTypes.has(n.entity_type))
  );

  const total = others.length;
  const visible = others.slice(0, GRAPH_NODE_CAP);
  const hidden = total - visible.length;

  const visibleIds = new Set(visible.map((n) => `${n.entity_type}:${n.id}`));
  const filteredEdges = raw.edges.filter((e) => {
    const fromVisible =
      (e.from_id === center?.id && e.from_type === center?.entity_type) ||
      visibleIds.has(`${e.from_type}:${e.from_id}`);
    const toVisible =
      (e.to_id === center?.id && e.to_type === center?.entity_type) ||
      visibleIds.has(`${e.to_type}:${e.to_id}`);
    return fromVisible && toVisible;
  });

  const nodes = center ? [center, ...visible] : visible;
  return {
    ...raw,
    nodes,
    edges: filteredEdges,
    hidden_count: hidden,
    total_neighbors: total,
  };
}

interface LayoutResult {
  placedAt: Record<string, { x: number; y: number }>;
  sectors: Array<{ type: EntityGraphNodeType; midAngle: number; count: number; sectorR: number }>;
}

function computeLayout(others: EntityGraphNode[]): LayoutResult {
  const placedAt: Record<string, { x: number; y: number }> = {};
  const sectors: LayoutResult['sectors'] = [];

  if (others.length === 0) return { placedAt, sectors };

  if (others.length <= 8) {
    /**
     * Few-node fast path: skip per-type wedge grouping so a single-type
     * cluster (e.g. 5 notes) doesn't all stack in one wedge vertically.
     * N=1..4 use cardinal positions for maximum horizontal spread;
     * N=5..8 use even angular distribution starting at 12 o'clock.
     */
    const r = 200;
    for (let i = 0; i < others.length; i++) {
      const angle = (() => {
        const n = others.length;
        if (n === 1) return 0;
        if (n === 2) return i === 0 ? Math.PI : 0;
        if (n === 3) return -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        if (n === 4) return -Math.PI / 2 + (i * Math.PI) / 2;
        return -Math.PI / 2 + (i * 2 * Math.PI) / n;
      })();
      const n = others[i];
      placedAt[`${n.entity_type}:${n.id}`] = {
        x: CX + r * Math.cos(angle),
        y: CY + r * Math.sin(angle),
      };
    }
  } else {
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
    let cursor = -Math.PI / 2;

    const MARGIN = 30;
    const HALF_W = (W - 2 * MARGIN) / 2;
    const HALF_H = (H - 2 * MARGIN) / 2;
    const maxRForAngle = (angle: number): number => {
      const cosA = Math.abs(Math.cos(angle));
      const sinA = Math.abs(Math.sin(angle));
      if (sinA < 0.01) return HALF_W;
      if (cosA < 0.01) return HALF_H;
      return Math.min(HALF_W / cosA, HALF_H / sinA);
    };

    for (const t of orderedTypes) {
      const nodes = byType.get(t)!;
      const sweep = (nodes.length / others.length) * 2 * Math.PI;
      const startAngle = cursor + gapRad / 2;
      const endAngle = cursor + sweep - gapRad / 2;
      const midAngle = (startAngle + endAngle) / 2;

      const sectorR = Math.min(maxRForAngle(midAngle), R_OUTER);
      const scale = sectorR / R_OUTER;
      const sectorRInner = R_INNER * scale;
      const sectorRingSpacing = ringSpacing * scale;
      const sectorJitter = 40 * scale;

      const ringCapacity = (ring: number): number => {
        if (ring === 0) return 1;
        return Math.floor(ring / 2) + 2;
      };
      const minSpacing = 140;
      const maxRings = Math.floor((sectorR - sectorRInner) / sectorRingSpacing) + 1;
      const clusterPos: Array<{ angle: number; radius: number }> = [];
      let placed = 0;
      let ring = 0;
      while (placed < nodes.length && ring < maxRings) {
        const cap = ringCapacity(ring);
        const slots = Math.min(cap, nodes.length - placed);
        const ringR = sectorR - ring * sectorRingSpacing;
        if (slots === 1) {
          clusterPos.push({ angle: midAngle, radius: ringR });
        } else {
          const spreadRad = Math.min(
            ((slots - 1) * minSpacing) / ringR,
            sweep * 0.95
          );
          for (let j = 0; j < slots; j++) {
            const t2 = j / (slots - 1);
            const jitter = j % 2 === 0 ? -sectorJitter : sectorJitter;
            clusterPos.push({
              angle: midAngle - spreadRad / 2 + spreadRad * t2,
              radius: ringR + jitter,
            });
          }
        }
        placed += slots;
        ring++;
      }
      while (placed < nodes.length) {
        const overflowIdx = placed - maxRings;
        const angleJitter = (overflowIdx % 2 === 0 ? -1 : 1) * (8 * Math.ceil((overflowIdx + 1) / 2));
        clusterPos.push({
          angle: midAngle + (angleJitter * Math.PI) / 180,
          radius: sectorRInner + 10,
        });
        placed++;
      }

      nodes.forEach((n, i) => {
        const pos = clusterPos[i];
        placedAt[`${n.entity_type}:${n.id}`] = {
          x: CX + pos.radius * Math.cos(pos.angle),
          y: CY + pos.radius * Math.sin(pos.angle),
        };
      });
      sectors.push({ type: t, midAngle, count: nodes.length, sectorR });
      cursor += sweep;
    }
  }

  return { placedAt, sectors };
}

interface GraphEdgeProps {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  stroke: string;
}

/** Memoized edge line — coords are stable across hover state changes. */
const GraphEdge = memo(function GraphEdge({ ax, ay, bx, by, stroke }: GraphEdgeProps) {
  return (
    <line
      x1={ax}
      y1={ay}
      x2={bx}
      y2={by}
      stroke={stroke}
      strokeWidth={1.5}
      opacity={0.5}
    />
  );
});

interface HoverableNodeProps {
  node: EntityGraphNode;
  isHovered: boolean;
  x: number;
  y: number;
  meta: { icon: string; color: string; label: string };
  onNeighborOpen: (n: EntityGraphNode) => void;
  onHoverEnter: (key: string) => void;
  onHoverLeave: (key: string) => void;
}

/**
 * Memoized neighbor node. Props are stable across hover state changes
 * (node, x, y, meta, callbacks all memoized at the parent), so only the
 * previously-hovered and newly-hovered nodes re-render when hoveredId
 * changes — every other node is skipped by React.memo.
 */
const HoverableNode = memo(function HoverableNode({
  node,
  isHovered,
  x,
  y,
  meta,
  onNeighborOpen,
  onHoverEnter,
  onHoverLeave,
}: HoverableNodeProps) {
  const key = `${node.entity_type}:${node.id}`;
  return (
    <g
      data-testid={`graph-node-${node.entity_type}-${node.id}`}
      style={{ cursor: 'pointer', transition: 'transform 180ms ease' }}
      onMouseEnter={() => onHoverEnter(key)}
      onMouseLeave={() => onHoverLeave(key)}
      onClick={() => onNeighborOpen(node)}
    >
      <circle cx={x} cy={y} r={NODE_R + 6} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={isHovered ? NODE_R + 6 : NODE_R}
        fill="#fff"
        stroke={meta.color}
        strokeWidth={isHovered ? 3 : 2}
        pointerEvents="none"
        style={isHovered ? { filter: `drop-shadow(0 4px 10px ${meta.color}55)` } : undefined}
      />
      <text
        x={x}
        y={isHovered ? y + 6 : y + 5}
        fontSize={isHovered ? 24 : 18}
        textAnchor="middle"
        pointerEvents="none"
      >
        {meta.icon}
      </text>
      <text
        x={x}
        y={isHovered ? y + NODE_R + 18 : y + NODE_R + 14}
        fontSize={isHovered ? 14 : 11}
        fontWeight={isHovered ? 600 : undefined}
        fill={isHovered ? '#0f172a' : '#1e293b'}
        textAnchor="middle"
        pointerEvents="none"
        style={{ paintOrder: 'stroke', stroke: '#fafbff', strokeWidth: isHovered ? 4 : 3 }}
      >
        {truncate(node.label, isHovered ? 18 : 14)}
      </text>
    </g>
  );
});

interface GraphSvgProps {
  data: EntityGraphResponse & { hidden_count: number; total_neighbors: number };
  onNeighborOpen: (n: EntityGraphNode) => void;
  onQuickCreate?: () => void;
}

function GraphSvg({ data, onNeighborOpen, onQuickCreate }: GraphSvgProps) {
  const center = useMemo(() => data.nodes.find((n) => n.is_center), [data]);
  const centerType = center?.entity_type;
  const others = useMemo(() => data.nodes.filter((n) => !n.is_center), [data]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { placedAt, sectors } = useMemo(() => computeLayout(others), [others]);

  const onHoverEnter = useCallback((key: string) => setHoveredId(key), []);
  const onHoverLeave = useCallback(
    (key: string) => setHoveredId((cur) => (cur === key ? null : cur)),
    []
  );

  const centerKey = center ? `${center.entity_type}:${center.id}` : '';

  return (
    <>
      {data.hidden_count > 0 && (
        <div
          data-testid="graph-overflow-banner"
          style={{
            padding: '6px 12px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: 13,
            marginBottom: 8,
            borderRadius: 6,
          }}
        >
          ⚠️ 还有 {data.hidden_count} 个关联未显示(共 {data.total_neighbors} 个)。
        </div>
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
          <circle cx={CX} cy={CY} r={R_OUTER + 30} fill="none" stroke="#e5e7eb" strokeDasharray="2 4" opacity={0.4} />

          {data.edges.map((e, i) => {
            const fromKey = `${e.from_type}:${e.from_id}`;
            const toKey = `${e.to_type}:${e.to_id}`;
            const ax = fromKey === centerKey ? CX : placedAt[fromKey]?.x ?? CX;
            const ay = fromKey === centerKey ? CY : placedAt[fromKey]?.y ?? CY;
            const bx = toKey === centerKey ? CX : placedAt[toKey]?.x ?? CX;
            const by = toKey === centerKey ? CY : placedAt[toKey]?.y ?? CY;
            const stroke = TYPE_META[e.to_type]?.color ?? '#94a3b8';
            return <GraphEdge key={i} ax={ax} ay={ay} bx={bx} by={by} stroke={stroke} />;
          })}

          {center && centerType && (
            <g data-testid="graph-center">
              <circle cx={CX} cy={CY} r={CENTER_R} fill={TYPE_META[centerType].color} stroke="#1e293b" strokeWidth={2} />
              <text x={CX} y={CY + 5} fontSize="14" fontWeight={700} fill="#fff" textAnchor="middle">
                {TYPE_META[centerType].icon}
              </text>
              <text x={CX} y={CY + CENTER_R + 16} fontSize="12" fontWeight={600} fill="#1e293b" textAnchor="middle">
                {truncate(center.label, 18)}
              </text>
              {onQuickCreate && (
                <g
                  data-testid="graph-center-quick-create"
                  style={{ cursor: 'pointer' }}
                  onClick={onQuickCreate}
                >
                  <circle
                    cx={CX + CENTER_R - 4}
                    cy={CY - CENTER_R + 4}
                    r={13}
                    fill="#fff"
                    stroke={TYPE_META[centerType].color}
                    strokeWidth={2}
                  />
                  <text
                    x={CX + CENTER_R - 4}
                    y={CY - CENTER_R + 9}
                    fontSize="18"
                    fontWeight={700}
                    fill={TYPE_META[centerType].color}
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    +
                  </text>
                </g>
              )}
            </g>
          )}

          {sectors.map((s) => {
            const meta = TYPE_META[s.type];
            const lr = s.sectorR + 30;
            const lx = CX + lr * Math.cos(s.midAngle);
            const ly = CY + lr * Math.sin(s.midAngle);
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
            <text x={CX} y={CY + R_OUTER + 40} fontSize="13" fill="#94a3b8" textAnchor="middle">
              暂无关联
            </text>
          )}

          {others
            .filter((n) => `${n.entity_type}:${n.id}` !== hoveredId)
            .map((n) => {
              const key = `${n.entity_type}:${n.id}`;
              const p = placedAt[key];
              if (!p) return null;
              const meta = TYPE_META[n.entity_type];
              if (!meta) return null;
              return (
                <HoverableNode
                  key={key}
                  node={n}
                  isHovered={false}
                  x={p.x}
                  y={p.y}
                  meta={meta}
                  onNeighborOpen={onNeighborOpen}
                  onHoverEnter={onHoverEnter}
                  onHoverLeave={onHoverLeave}
                />
              );
            })}

          {/* SVG has no z-index — re-render the hovered node last so it sits on top */}
          {others
            .filter((n) => `${n.entity_type}:${n.id}` === hoveredId)
            .map((n) => {
              const key = `${n.entity_type}:${n.id}`;
              const p = placedAt[key];
              if (!p) return null;
              const meta = TYPE_META[n.entity_type];
              if (!meta) return null;
              return (
                <HoverableNode
                  key={key}
                  node={n}
                  isHovered={true}
                  x={p.x}
                  y={p.y}
                  meta={meta}
                  onNeighborOpen={onNeighborOpen}
                  onHoverEnter={onHoverEnter}
                  onHoverLeave={onHoverLeave}
                />
              );
            })}
        </svg>
      </div>
    </>
  );
}

export default EntityGraph;
