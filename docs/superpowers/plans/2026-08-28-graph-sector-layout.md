# GraphView Sector Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three concentric rings in `GraphView.tsx` with a pie-slice layout (one wedge per present entity type, arc proportional to node count).

**Architecture:** Single-file rewrite of the layout section in `apps/web-spa/src/routes/GraphView.tsx`. Pure SVG, no library. Server untouched.

**Tech Stack:** React 18 + TypeScript 5, plain SVG, `@tanstack/react-query` (unchanged).

## Global Constraints

- TypeScript: `pnpm --filter web-spa run typecheck` must pass with zero errors.
- Vite build: `pnpm --filter web-spa run build` must succeed.
- No new dependencies.
- Preserve all `data-testid` attributes: `graph-svg`, `graph-center`, `graph-breadcrumb`, `graph-node-${type}-${id}`, `graph-node-${type}-${id}-drill`.
- Preserve `onNeighborOpen` (single-click) and `onNeighborDrill` (↗ button) behavior.
- No server change. Bug fix from v1.3.3 (drop tag-as-neighbor) remains in effect.

---

### Task 1: Replace layout constants and sector computation in GraphView.tsx

**Files:**
- Modify: `apps/web-spa/src/routes/GraphView.tsx:8-21` (constants block)
- Modify: `apps/web-spa/src/routes/GraphView.tsx:107-136` (layout computation block)

**Interfaces:**
- Consumes: `others: EntityGraphNode[]` (already filtered by tag-drop)
- Produces: `placedAt: Record<string, { x: number; y: number }>` keyed by `${type}:${id}`
- Produces: `sectors: Array<{ type: EntityGraphNodeType; midAngle: number; count: number }>` for label rendering

- [ ] **Step 1: Replace constants block (lines 8-21)**

Replace:
```typescript
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
```

With:
```typescript
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
```

- [ ] **Step 2: Replace layout computation (lines 117-136)**

Replace:
```typescript
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
```

With:
```typescript
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
    nodes.forEach((n, i) => {
      const a =
        nodes.length === 1
          ? midAngle
          : startAngle + ((endAngle - startAngle) * i) / (nodes.length - 1);
      placedAt[`${n.entity_type}:${n.id}`] = {
        x: cx + R_OUTER * Math.cos(a),
        y: cy + R_OUTER * Math.sin(a),
      };
    });
    sectors.push({ type: t, midAngle, count: nodes.length });
    cursor += sweep;
  }
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web-spa run typecheck`
Expected: zero errors. (`sectors` is unused at this step — Task 2 will consume it.)

- [ ] **Step 4: Commit**

```bash
git add apps/web-spa/src/routes/GraphView.tsx
git commit -m "feat(web-spa): sector-layout phase 1 — constants + placement math"
```

---

### Task 2: Render wedge backgrounds, wedge labels, drop rings, fix edges

**Files:**
- Modify: `apps/web-spa/src/routes/GraphView.tsx:208-355` (the SVG `<svg>...</svg>` block)

- [ ] **Step 1: Remove ring circles (lines 217-229)**

Delete:
```typescript
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
```

- [ ] **Step 2: Replace edge rendering (lines 231-261) — straight lines instead of curved paths**

Replace:
```typescript
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
```

With:
```typescript
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
      x1={ax} y1={ay} x2={bx} y2={by}
      stroke={stroke}
      strokeWidth={1.5}
      opacity={0.5}
    />
  );
})}
```

- [ ] **Step 3: Add wedge backgrounds just before the center circle (inside `<svg>`, after `</circle>` if any, before edges)**

Insert before the `{graph.edges.map(...)}` line:
```typescript
{sectors.map((s, i) => {
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
```

- [ ] **Step 4: Add wedge labels after the center `<g>` block (lines 263-273), before the empty-state text**

Insert after the center `</g>` (current line 273):
```typescript
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
```

- [ ] **Step 5: Update empty-state position (current lines 275-279)**

The current text uses `cy + RING_RADII[2] + 70`. Replace with:
```typescript
<text x={cx} y={cy + R_OUTER + 40} fontSize="13" fill="#94a3b8" textAnchor="middle">
  暂无关联
</text>
```

- [ ] **Step 6: Type-check**

Run: `pnpm --filter web-spa run typecheck`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web-spa/src/routes/GraphView.tsx
git commit -m "feat(web-spa): GraphView sector layout — wedges + labels + straight edges"
```

---

### Task 3: Build, deploy, tag

- [ ] **Step 1: Build web bundle**

Run: `pnpm --filter web-spa run build`
Expected: `dist/spa/index-*.js` produced. Note the chunk hash for verification.

- [ ] **Step 2: Deploy**

Run: `bash scripts/deploy-web.sh`
Expected: ends with `✓ Web SPA deployed to https://weavine.financialagent.cc/`.

- [ ] **Step 3: Smoke-test in browser**

Open `https://weavine.financialagent.cc/graph/contact/706e9011-e52d-4164-b38e-19a76eff1719`.
Expected: pie-slice layout, no JS errors in console, center node visible, neighbor nodes clustered into wedges by type with labels.

- [ ] **Step 4: Tag and push**

```bash
git tag -a v1.3.4 -m "feat(web-spa): GraphView sector layout

Replace three concentric rings with a pie-slice layout: one wedge per
present entity type, arc proportional to node count, label at wedge
midpoint. Server untouched. Tag-as-neighbor fix from v1.3.3 still in
effect.

Spec: docs/superpowers/specs/2026-08-28-graph-sector-layout-design.md"
git push origin v1.3.4
```

Expected: ends with `* [new tag] v1.3.4 -> v1.3.4`.

---

## Self-Review

**1. Spec coverage:**
- ✓ Pie-slice layout, arc proportional — Task 1 cursor/sweep math, Task 2 wedge path.
- ✓ Start at 12 o'clock clockwise — Task 1 `cursor = -Math.PI / 2`, sweep adds positive radians (which is clockwise in SVG y-down).
- ✓ Wedge background fill 5% opacity — Task 2 Step 3.
- ✓ Wedge label `{icon} {label} · {count}` — Task 2 Step 4.
- ✓ Straight center→node edges — Task 2 Step 2.
- ✓ Drill button (↗) preserved — not touched in any task.
- ✓ Breadcrumb preserved — not touched in any task.
- ✓ Empty state preserved — Task 2 Step 5.
- ✓ `data-testid`s preserved — node group key and testid unchanged in the node-mapping block (not modified).

**2. Placeholder scan:** no TBD / "implement later" / "add tests" placeholders.

**3. Type consistency:** `placedAt` key format `${type}:${id}` is identical between Tasks 1 and 2 (both consume/produce the same map). `sectors` shape `{ type, midAngle, count }` is consistent across Tasks 1 and 2.