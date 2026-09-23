import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { TYPE_META } from './EntityGraph';
import { nextReminderIn } from '../lib/keepInTouch';
import type { Action, Contact, Event, Project } from '../lib/adapter/types';

// Home-page "me-centered" relationship graph. Unlike EntityGraph (which is
// anchored on one entity and walks its neighbours), the home graph places a
// virtual 我 at the center, the user's most relevant contacts on the inner
// ring, and each contact's open events/actions/projects on an outer ring.
//
// Visual language intentionally mirrors EntityGraph (white nodes + type-color
// stroke + emoji icon + label halo, same edge style) so drilling from here
// into /graph/:type/:id feels like zooming into the same picture. Node
// clicks open the entity's graph view — the whole home page is a doorway
// into the weave, not a dashboard.

interface Satellite {
  id: string;
  kind: 'event' | 'action' | 'project';
  label: string;
  /** Contacts this satellite is tied to (event participant / action owner / project members, capped). */
  linkedContactIds: string[];
  /** Members beyond the edge cap (projects only) — shown as a +N badge. */
  extraContacts?: number;
  href: string;
}

const MAX_CONTACTS = 8;
const MAX_SATELLITES = 12;

const W = 900;
const H = 460;
const CX = W / 2;
const CY = H / 2;
const R_INNER = 120;
const R_OUTER = 190;

const CENTER_R = 44;
const NODE_R = 28;

const ME_COLOR = '#1e293b';

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function polar(r: number, angle: number): { x: number; y: number } {
  return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
}

const IMPORTANCE_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Who earns a spot on the inner ring when there are more contacts than
 * slots? The weave answers "who should I see right now":
 *   0. keep-in-touch already overdue            — they need action today
 *   1. imminent commitment (≤7d): upcoming
 *      event or open action due with them       — a meeting is coming
 *   2. interacted within 7 days                 — active threads
 *   3. interacted within 30 days
 *   4. high importance, however stale           — matters even if quiet
 *   5. everything else, most recent first
 * Ties break by the tier's own date (soonest first), then importance.
 * High-importance contacts can never flood the ring: they sit in tier 4
 * and only fill slots left over after overdue/imminent/recent people.
 */
function sortContactsForHome(
  contacts: Contact[],
  events: Event[],
  actions: Action[],
): Contact[] {
  const now = new Date();
  const soon = now.getTime() + 7 * 86_400_000;

  // Per-contact timestamp of the soonest imminent commitment, if any.
  const imminentAt = new Map<string, number>();
  for (const e of events) {
    if (!e.contact_id) continue;
    const t = new Date(e.start_at).getTime();
    if (t >= now.getTime() && t <= soon) {
      const cur = imminentAt.get(e.contact_id);
      if (cur === undefined || t < cur) imminentAt.set(e.contact_id, t);
    }
  }
  for (const a of actions) {
    if (a.status === 'done' || !a.contact_id || !a.due_at) continue;
    const t = new Date(a.due_at).getTime();
    if (t <= soon) {
      const cur = imminentAt.get(a.contact_id);
      if (cur === undefined || t < cur) imminentAt.set(a.contact_id, t);
    }
  }

  const daysSince = (iso: string | null | undefined): number | null =>
    iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000) : null;

  return [...contacts].sort((a, b) => {
    const score = (c: Contact): { tier: number; at: number } => {
      const r = nextReminderIn(c.last_interaction_at, c.importance, c.keep_in_touch_cadence_days, now);
      if (r.hasCadence && r.days !== null && r.days <= 0) {
        return { tier: 0, at: r.days }; // most overdue first
      }
      const im = imminentAt.get(c.id);
      if (im !== undefined) return { tier: 1, at: im }; // soonest commitment first
      const d = daysSince(c.last_interaction_at);
      if (d !== null && d < 7) return { tier: 2, at: d };
      if (d !== null && d < 30) return { tier: 3, at: d };
      if (c.importance === 'high') return { tier: 4, at: d ?? Number.MAX_SAFE_INTEGER };
      return { tier: 5, at: d ?? Number.MAX_SAFE_INTEGER };
    };
    const sa = score(a);
    const sb = score(b);
    if (sa.tier !== sb.tier) return sa.tier - sb.tier;
    if (sa.at !== sb.at) return sa.at - sb.at;
    const wa = IMPORTANCE_WEIGHT[a.importance] ?? 2;
    const wb = IMPORTANCE_WEIGHT[b.importance] ?? 2;
    return wa - wb;
  });
}

interface Props {
  contacts: Contact[];
  events: Event[];
  actions: Action[];
  projects: Project[];
}

export function HomeGraph({ contacts, events, actions, projects }: Props) {
  const navigate = useNavigate();
  const adapter = useAdapter();
  const [addOpen, setAddOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.completed_at).slice(0, 5),
    [projects],
  );

  // Project members power the project→contact edges. One query per displayed
  // project is fine at home scale (≤5).
  const projectMembersQuery = useQuery({
    queryKey: ['home-project-members', activeProjects.map((p) => p.id)],
    queryFn: async () => {
      const entries = await Promise.all(
        activeProjects.map(async (p) => {
          try {
            const members = await adapter.projectContacts.list(p.id);
            return [p.id, members.map((m) => m.contact.id)] as const;
          } catch {
            return [p.id, [] as string[]] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, string[]>;
    },
    enabled: activeProjects.length > 0,
  });

  const nodes = useMemo(() => {
    const pickedContacts = sortContactsForHome(contacts, events, actions).slice(0, MAX_CONTACTS);
    const contactIds = new Set(pickedContacts.map((c) => c.id));

    const openActions = actions.filter((a) => a.status !== 'done');

    const satellites: Satellite[] = [];
    for (const e of events) {
      satellites.push({
        id: `event:${e.id}`,
        kind: 'event',
        label: e.title,
        linkedContactIds: e.contact_id ? [e.contact_id] : [],
        href: `/graph/event/${e.id}`,
      });
    }
    for (const a of openActions) {
      satellites.push({
        id: `action:${a.id}`,
        kind: 'action',
        label: a.title,
        linkedContactIds: a.contact_id ? [a.contact_id] : [],
        href: `/graph/action/${a.id}`,
      });
    }
    for (const p of activeProjects) {
      const members = projectMembersQuery.data?.[p.id] ?? [];
      satellites.push({
        id: `project:${p.id}`,
        kind: 'project',
        label: p.title,
        linkedContactIds: members.slice(0, 3),
        extraContacts: Math.max(0, members.length - 3),
        href: `/graph/project/${p.id}`,
      });
    }

    const pickedSatellites = satellites.slice(0, MAX_SATELLITES);
    const attachedSatellites = pickedSatellites.filter((s) =>
      s.linkedContactIds.some((cid) => contactIds.has(cid)),
    );
    const orbitSatellites = pickedSatellites.filter(
      (s) => !s.linkedContactIds.some((cid) => contactIds.has(cid)),
    );

    const contactNodes = pickedContacts.map((c, i) => {
      const angle = (2 * Math.PI * i) / Math.max(pickedContacts.length, 1) - Math.PI / 2;
      return { contact: c, angle, ...polar(R_INNER, angle) };
    });

    const contactAngleById = new Map(contactNodes.map((n) => [n.contact.id, n.angle]));

    const satelliteNodes = [
      ...(() => {
        // Spread satellites sharing the same anchor contact symmetrically
        // (-1, 0, +1 …) so their labels don't stack.
        const anchorCounters = new Map<string, number>();
        return attachedSatellites.map((s) => {
          const anchor = s.linkedContactIds.find((cid) => contactAngleById.has(cid));
          const key = anchor ?? '';
          const idx = anchorCounters.get(key) ?? 0;
          anchorCounters.set(key, idx + 1);
          const base = anchor !== undefined ? contactAngleById.get(anchor)! : 0;
          const fan = (idx - 1) * 0.34;
          return { s, ...polar(R_OUTER, base + fan) };
        });
      })(),
      ...orbitSatellites.map((s, i) => {
        const angle =
          (2 * Math.PI * i) / Math.max(orbitSatellites.length, 1) -
          Math.PI / 2 +
          Math.PI / Math.max(orbitSatellites.length, 1);
        return { s, ...polar(R_OUTER + 14, angle) };
      }),
    ];

    return { contactNodes, satelliteNodes };
  }, [contacts, events, actions, activeProjects, projectMembersQuery.data]);

  const hasContent = nodes.contactNodes.length > 0 || nodes.satelliteNodes.length > 0;
  const hiddenContacts = Math.max(0, contacts.length - MAX_CONTACTS);

  return (
    <div className="card" style={{ position: 'relative', padding: 0, overflow: 'hidden' }}>
      {hiddenContacts > 0 && (
        <div
          data-testid="home-graph-overflow"
          style={{
            padding: '5px 12px',
            background: '#f0f9ff',
            borderBottom: '1px solid #bae6fd',
            color: '#075985',
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>还有 {hiddenContacts} 位联系人未上图（按最近互动与重要程度优先展示）</span>
          <a
            href="/contacts"
            onClick={(e) => {
              e.preventDefault();
              navigate('/contacts');
            }}
            style={{ color: 'inherit', fontWeight: 600 }}
          >
            查看全部 →
          </a>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px 0',
        }}
      >
        <h2 className="section__title" style={{ margin: 0 }}>🕸️ 我的人脉网</h2>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="section__view-all"
            onClick={() => setAddOpen((o) => !o)}
          >
            ＋ 添加
          </button>
          {addOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 6,
                zIndex: 30,
                background: 'var(--bg-elevated, #fff)',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 128,
              }}
            >
              {[
                { label: '👤 联系人', href: '/contacts/new' },
                { label: '📅 日程', href: '/events/new' },
                { label: '✅ 待办', href: '/actions/new' },
                { label: '📁 项目', href: '/projects/new' },
              ].map((item) => (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    navigate(item.href);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    padding: '7px 10px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {hasContent ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="以我为中心的人脉关系图"
          width="100%"
          height={H}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', background: 'linear-gradient(180deg,#fafbff,#f3f4f8)' }}
        >
          <circle cx={CX} cy={CY} r={R_OUTER + 30} fill="none" stroke="#e5e7eb" strokeDasharray="2 4" opacity={0.4} />
          <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="#e5e7eb" strokeDasharray="2 4" opacity={0.3} />

          {/* spokes: 我 → contacts */}
          {nodes.contactNodes.map((n) => (
            <line
              key={`spoke-${n.contact.id}`}
              x1={CX}
              y1={CY}
              x2={n.x}
              y2={n.y}
              stroke={TYPE_META.contact.color}
              strokeWidth={1.5}
              opacity={0.5}
            />
          ))}
          {/* edges: contact → satellite (event participant / action owner / project members) */}
          {nodes.satelliteNodes.map((sn) =>
            sn.s.linkedContactIds
              .filter((cid) => nodes.contactNodes.some((cn) => cn.contact.id === cid))
              .map((cid) => {
                const cn = nodes.contactNodes.find((c) => c.contact.id === cid)!;
                return (
                  <line
                    key={`edge-${sn.s.id}-${cid}`}
                    x1={cn.x}
                    y1={cn.y}
                    x2={sn.x}
                    y2={sn.y}
                    stroke={TYPE_META[sn.s.kind].color}
                    strokeWidth={1.5}
                    opacity={0.5}
                  />
                );
              }),
          )}

          {/* satellites (outer ring) — EntityGraph node style */}
          {nodes.satelliteNodes.map((sn) => {
            const key = sn.s.id;
            const isHovered = hoveredKey === key;
            const meta = TYPE_META[sn.s.kind];
            return (
              <g
                key={key}
                data-testid={`home-graph-node-${sn.s.kind}-${sn.s.id}`}
                style={{ cursor: 'pointer', transition: 'transform 180ms ease' }}
                onMouseEnter={() => setHoveredKey(key)}
                onMouseLeave={() => setHoveredKey((cur) => (cur === key ? null : cur))}
                onClick={() => navigate(sn.s.href)}
              >
                <title>{sn.s.label}</title>
                <circle cx={sn.x} cy={sn.y} r={NODE_R + 6} fill="transparent" />
                <circle
                  cx={sn.x}
                  cy={sn.y}
                  r={isHovered ? NODE_R + 6 : NODE_R}
                  fill="#fff"
                  stroke={meta.color}
                  strokeWidth={isHovered ? 3 : 2}
                  pointerEvents="none"
                  style={isHovered ? { filter: `drop-shadow(0 4px 10px ${meta.color}55)` } : undefined}
                />
                <text
                  x={sn.x}
                  y={isHovered ? sn.y + 6 : sn.y + 5}
                  fontSize={isHovered ? 24 : 18}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {meta.icon}
                </text>
                <text
                  x={sn.x}
                  y={isHovered ? sn.y + NODE_R + 18 : sn.y + NODE_R + 14}
                  fontSize={isHovered ? 14 : 11}
                  fontWeight={isHovered ? 600 : undefined}
                  fill={isHovered ? '#0f172a' : '#1e293b'}
                  textAnchor="middle"
                  pointerEvents="none"
                  style={{ paintOrder: 'stroke', stroke: '#fafbff', strokeWidth: isHovered ? 4 : 3 }}
                >
                  {truncate(sn.s.label, isHovered ? 18 : 14)}
                </text>
                {!isHovered && !!sn.s.extraContacts && (
                  <text
                    x={sn.x}
                    y={isHovered ? sn.y + NODE_R + 32 : sn.y + NODE_R + 26}
                    fontSize={10}
                    fontWeight={600}
                    fill={meta.color}
                    textAnchor="middle"
                    pointerEvents="none"
                    style={{ paintOrder: 'stroke', stroke: '#fafbff', strokeWidth: 3 }}
                  >
                    +{sn.s.extraContacts} 人
                  </text>
                )}
              </g>
            );
          })}

          {/* contacts (inner ring) — EntityGraph node style, 👤 icon */}
          {nodes.contactNodes.map((n) => {
            const key = `contact:${n.contact.id}`;
            const isHovered = hoveredKey === key;
            const meta = TYPE_META.contact;
            return (
              <g
                key={key}
                data-testid={`home-graph-node-contact-${n.contact.id}`}
                style={{ cursor: 'pointer', transition: 'transform 180ms ease' }}
                onMouseEnter={() => setHoveredKey(key)}
                onMouseLeave={() => setHoveredKey((cur) => (cur === key ? null : cur))}
                onClick={() => navigate(`/graph/contact/${n.contact.id}`)}
              >
                <title>{n.contact.nickname} 的关系图</title>
                <circle cx={n.x} cy={n.y} r={NODE_R + 6} fill="transparent" />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={isHovered ? NODE_R + 6 : NODE_R}
                  fill="#fff"
                  stroke={meta.color}
                  strokeWidth={isHovered ? 3 : 2}
                  pointerEvents="none"
                  style={isHovered ? { filter: `drop-shadow(0 4px 10px ${meta.color}55)` } : undefined}
                />
                <text
                  x={n.x}
                  y={isHovered ? n.y + 6 : n.y + 5}
                  fontSize={isHovered ? 24 : 18}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {meta.icon}
                </text>
                <text
                  x={n.x}
                  y={isHovered ? n.y + NODE_R + 18 : n.y + NODE_R + 14}
                  fontSize={isHovered ? 14 : 11}
                  fontWeight={isHovered ? 600 : undefined}
                  fill={isHovered ? '#0f172a' : '#1e293b'}
                  textAnchor="middle"
                  pointerEvents="none"
                  style={{ paintOrder: 'stroke', stroke: '#fafbff', strokeWidth: isHovered ? 4 : 3 }}
                >
                  {truncate(n.contact.nickname, isHovered ? 18 : 8)}
                </text>
              </g>
            );
          })}

          {/* 我 at the center — mirrors EntityGraph's center node */}
          <g data-testid="home-graph-center">
            <circle cx={CX} cy={CY} r={CENTER_R} fill={ME_COLOR} stroke={ME_COLOR} strokeWidth={2} />
            <text x={CX} y={CY + 5} fontSize="16" fontWeight={700} fill="#fff" textAnchor="middle">
              我
            </text>
          </g>
        </svg>
      ) : (
        <div className="empty-state" style={{ padding: '36px 16px' }}>
          <h3 className="empty-state__title">你的关系网还是空的</h3>
          <p className="empty-state__hint">添加第一个联系人，开始编织你的人脉</p>
        </div>
      )}
    </div>
  );
}
