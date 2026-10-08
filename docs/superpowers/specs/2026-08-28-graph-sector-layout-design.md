# GraphView — Sector Layout Design

**Date:** 2026-08-28
**Status:** Approved
**Target release:** v1.3.4
**Scope:** `apps/web-spa/src/routes/GraphView.tsx` only — server untouched.

## Problem

The current `GraphView` lays out neighbors on three concentric rings (RING_RADII = [150, 240, 330]). With 4–5 surrounding entity types and the contact at center, nodes scatter all 360°. Users can't tell at a glance "which side is interactions, which is notes".

## Goal

Cluster neighbors by entity type into a pie-slice layout: one wedge per present type, arc proportional to node count, label at the wedge's outer edge. Center stays a single hub node.

## Non-goals

- No new entity types added.
- No server change.
- No drill-down interaction changes (↗ button + breadcrumb preserved).
- No new tests — the data-testids (`graph-node-${type}-${id}`, `graph-svg`, `graph-breadcrumb`, `graph-center`, `graph-node-...-drill`) are unchanged.

## Design

### Layout

Replace the three concentric rings with a sector (pie-slice) layout.

```
canvas: viewBox 0 0 900 820
center: (450, 410)
R_INNER  = 110   // clear gap around the center node
R_OUTER  = 320   // outer arc where neighbor nodes sit
```

For every entity type that has at least one neighbor:

1. **Arc sweep** = `(count / total_neighbors) * 360°`. Pure proportional.
2. **First wedge** starts at the 12-o'clock direction (angle = -π/2). Sectors proceed **clockwise**.
3. **Gap between sectors** = 2° (small visual separator).
4. **Within a wedge**: nodes are placed uniformly along the outer arc.
   - 1 node → placed at the wedge midpoint.
   - N nodes → evenly spaced from `start_angle` to `end_angle`.
5. **Wedge background**: a faint filled annulus from R_INNER to R_OUTER, `TYPE_META[type].color` at 5% opacity. This visually delineates the wedge.
6. **Wedge label**: at the wedge midpoint, pushed outward by 30 px past R_OUTER. Text: `{icon} {label} · {count}`. 12px, fill #1e293b.

### Edge rendering

- Center → neighbor: **straight line** (replaces the current curved quadratic).
- Color: `TYPE_META[to_type].color` at 50% opacity, strokeWidth 1.5.
- Bow jitter from the current implementation is dropped — pure proportional sectors don't need it.

### Center node

Unchanged. Same circle (radius 44) with icon and label below.

### Drill / open

Unchanged. Single click opens detail; ↗ button drills in.

### Empty state

If `others.length === 0`, render a single text label "暂无关联" below the center. No wedges.

### Node radius

Default 32 px. If a wedge has > 12 nodes (visually crowded), scale node radius down linearly so the tightest wedge still fits:
- `R_eff = 32 * min(1, 12 / count)`
- Floor at 18 px so the icon stays legible.

## Trade-offs

- **Very uneven counts** (e.g., 1 interaction + 30 notes) → notes occupy ~290°, interaction ~3°. Acceptable per user preference ("纯比例").
- **Wedge gaps**: 2° between sectors adds a visible separator, costs ~10° total in a 5-type scenario. Acceptable.
- **Edge crossings** within a dense wedge: lines may overlap each other since they all originate from center. Mitigated by fading (50% opacity). If it becomes annoying, can switch to per-edge slight offset later.

## Files changed

- `apps/web-spa/src/routes/GraphView.tsx` — single-file rewrite of the layout section.

## Build / ship

- Type-check: `pnpm --filter web-spa run typecheck`
- Build: `pnpm --filter web-spa run build`
- Deploy: `scripts/deploy-web.sh` (already fixed to handle multi-chunk vite output)
- Tag: `v1.3.4`

## Server status

No changes. The bug fix for tag-as-neighbor (v1.3.3) is still in effect.

## Future ideas (out of scope)

- Pan/zoom on the SVG for very large graphs.
- Animated transitions when sectors resize after a fetch.
- Show only the count badge, with click-to-expand for sectors with many nodes.