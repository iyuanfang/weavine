import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Action, Contact, Event, Project } from '../lib/adapter/types';

// Home-page "me-centered" relationship graph. Unlike EntityGraph (which is
// anchored on one entity and walks its neighbours), the home graph places a
// virtual 我 at the center, the user's most relevant contacts on the inner
// ring, and each contact's open events/actions/projects on an outer ring —
// the "weave" the product is about, visible without digging into detail tabs.

interface Satellite {
  id: string;
  kind: 'event' | 'action' | 'project';
  label: string;
  contactId: string | null;
  href: string;
}

const NODE_COLORS: Record<string, string> = {
  contact: 'var(--accent, #2563eb)',
  event: '#16a34a',
  action: '#ea580c',
  project: '#9333ea',
};

const MAX_CONTACTS = 10;
const MAX_SATELLITES = 14;

const W = 860;
const H = 430;
const CX = W / 2;
const CY = H / 2;
const R_INNER = 112;
const R_OUTER = 168;

function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

interface Props {
  contacts: Contact[];
  events: Event[];
  actions: Action[];
  projects: Project[];
}

export function HomeGraph({ contacts, events, actions, projects }: Props) {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);

  const nodes = useMemo(() => {
    const pickedContacts = contacts.slice(0, MAX_CONTACTS);
    const contactIds = new Set(pickedContacts.map((c) => c.id));

    const openActions = actions.filter((a) => a.status !== 'done');
    const activeProjects = projects.filter((p) => !p.completed_at);

    const satellites: Satellite[] = [];
    for (const e of events) {
      satellites.push({
        id: `event:${e.id}`,
        kind: 'event',
        label: e.title,
        contactId: e.contact_id ?? null,
        href: `/events/${e.id}`,
      });
    }
    for (const a of openActions) {
      satellites.push({
        id: `action:${a.id}`,
        kind: 'action',
        label: a.title,
        contactId: a.contact_id ?? null,
        href: `/actions/${a.id}`,
      });
    }
    for (const p of activeProjects) {
      satellites.push({
        id: `project:${p.id}`,
        kind: 'project',
        label: p.title,
        contactId: null, // project members live in a join table; keep projects on the outer ring
        href: `/projects/${p.id}`,
      });
    }

    const pickedSatellites = satellites.slice(0, MAX_SATELLITES);
    const orbitSatellites = pickedSatellites.filter((s) => !s.contactId || !contactIds.has(s.contactId));
    const attachedSatellites = pickedSatellites.filter((s) => s.contactId && contactIds.has(s.contactId));

    const contactNodes = pickedContacts.map((c, i) => {
      const angle = (2 * Math.PI * i) / Math.max(pickedContacts.length, 1) - Math.PI / 2;
      return { contact: c, angle, ...polar(CX, CY, R_INNER, angle) };
    });

    const contactAngleById = new Map(contactNodes.map((n) => [n.contact.id, n.angle]));

    const satelliteNodes = [
      ...attachedSatellites.map((s, i) => {
        const base = contactAngleById.get(s.contactId!) ?? 0;
        // Fan attached satellites slightly around their contact's angle so
        // several items on one contact don't overlap.
        const fan = ((i % 3) - 1) * 0.22;
        const angle = base + fan;
        return { s, angle, ...polar(CX, CY, R_OUTER, angle) };
      }),
      ...orbitSatellites.map((s, i) => {
        const angle = (2 * Math.PI * i) / Math.max(orbitSatellites.length, 1) - Math.PI / 2 + Math.PI / Math.max(orbitSatellites.length, 1);
        return { s, angle, ...polar(CX, CY, R_OUTER + 16, angle) };
      }),
    ];

    return { contactNodes, satelliteNodes };
  }, [contacts, events, actions, projects]);

  const hasContent = nodes.contactNodes.length > 0 || nodes.satelliteNodes.length > 0;

  return (
    <div className="card" style={{ position: 'relative', padding: 0, overflow: 'hidden' }}>
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
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          {/* spokes: 我 → contacts */}
          {nodes.contactNodes.map((n) => (
            <line
              key={`spoke-${n.contact.id}`}
              x1={CX}
              y1={CY}
              x2={n.x}
              y2={n.y}
              stroke="var(--border, #d1d5db)"
              strokeWidth={1.4}
            />
          ))}
          {/* edges: contact → satellite */}
          {nodes.satelliteNodes
            .filter((sn) => sn.s.contactId && nodes.contactNodes.some((cn) => cn.contact.id === sn.s.contactId))
            .map((sn) => {
              const cn = nodes.contactNodes.find((c) => c.contact.id === sn.s.contactId)!;
              return (
                <line
                  key={`edge-${sn.s.id}`}
                  x1={cn.x}
                  y1={cn.y}
                  x2={sn.x}
                  y2={sn.y}
                  stroke={NODE_COLORS[sn.s.kind]}
                  strokeWidth={1.1}
                  strokeOpacity={0.45}
                  strokeDasharray="3 3"
                />
              );
            })}

          {/* satellites (outer ring) */}
          {nodes.satelliteNodes.map((sn) => (
            <g
              key={sn.s.id}
              onClick={() => navigate(sn.s.href)}
              style={{ cursor: 'pointer' }}
            >
              <title>{sn.s.label}</title>
              <circle cx={sn.x} cy={sn.y} r={9} fill={NODE_COLORS[sn.s.kind]} fillOpacity={0.92} />
              <text
                x={sn.x}
                y={sn.y - 14}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted, #6b7280)"
                style={{ pointerEvents: 'none' }}
              >
                {sn.s.label.length > 8 ? `${sn.s.label.slice(0, 8)}…` : sn.s.label}
              </text>
            </g>
          ))}

          {/* contacts (inner ring) */}
          {nodes.contactNodes.map((n) => (
            <g
              key={n.contact.id}
              onClick={() => navigate(`/contacts/${n.contact.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <title>{n.contact.nickname}</title>
              <circle cx={n.x} cy={n.y} r={22} fill="var(--accent, #2563eb)" />
              <text
                x={n.x}
                y={n.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12}
                fontWeight={600}
                fill="#fff"
                style={{ pointerEvents: 'none' }}
              >
                {n.contact.nickname.slice(0, 3)}
              </text>
            </g>
          ))}

          {/* 我 at the center */}
          <circle cx={CX} cy={CY} r={30} fill="var(--fg, #111827)" />
          <text
            x={CX}
            y={CY + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={15}
            fontWeight={700}
            fill="#fff"
          >
            我
          </text>
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
