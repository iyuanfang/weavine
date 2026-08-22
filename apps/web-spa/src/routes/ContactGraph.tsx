import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { avatarUrlFor } from '../lib/avatarUrl';
import type { GraphNode } from '../lib/adapter/types';

const RING1_RADIUS = 180;
const RING2_RADIUS = 320;
const NODE_R = 36;
const CENTER_R = 44;

function labelOf(n: GraphNode): string {
  return n.nickname ?? n.name ?? '?';
}

export function ContactGraph() {
  const { id: contactId } = useParams() as { id: string };
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const [depth, setDepth] = useState(2);
  const [showAdd, setShowAdd] = useState(false);

  const centerQuery = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => adapter.contacts.get(contactId),
  });
  const graphQuery = useQuery({
    queryKey: ['graph', contactId, depth],
    queryFn: () => adapter.graph.get(contactId, depth),
  });

  const avatarUrl = (n: GraphNode): string | null =>
    avatarUrlFor(
      {
        avatar_storage_key: n.avatar_storage_key ?? null,
        avatar_mime: n.avatar_mime ?? null,
      } as Parameters<typeof avatarUrlFor>[0],
      { baseUrl: adapter.baseUrl },
    );

  const removeMutation = useMutation({
    mutationFn: (otherId: string) => adapter.graph.removeRelation(contactId, otherId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['graph', contactId] }),
  });

  if (centerQuery.isLoading || graphQuery.isLoading) {
    return <div className="loading">加载中…</div>;
  }
  if (centerQuery.isError || graphQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">
          加载失败：{String(centerQuery.error ?? graphQuery.error)}
        </div>
      </div>
    );
  }

  const center = centerQuery.data!;
  const graph = graphQuery.data!;
  const others = graph.nodes.filter((n) => n.id !== contactId);

  const ring1 = others.filter((n) => {
    return graph.edges.some(
      (e) =>
        (e.from_id === contactId && e.to_id === n.id) ||
        (e.to_id === contactId && e.from_id === n.id),
    );
  });
  const ring2 = others.filter((n) => !ring1.includes(n));

  const placedAt: Record<string, { x: number; y: number }> = {};
  const cx = 400;
  const cy = 360;
  ring1.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(ring1.length, 1);
    placedAt[n.id] = {
      x: cx + RING1_RADIUS * Math.cos(a),
      y: cy + RING1_RADIUS * Math.sin(a),
    };
  });
  ring2.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(ring2.length, 1);
    placedAt[n.id] = {
      x: cx + RING2_RADIUS * Math.cos(a),
      y: cy + RING2_RADIUS * Math.sin(a),
    };
  });

  const W = 800;
  const H = 720;

  return (
    <div className="page">
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            🕸️ {labelOf(center)} · 关系图
          </span>
        }
        subtitle={
          <span>
            {graph.nodes.length} 个联系人 · {graph.edges.length} 条关系 ·{' '}
            <Link to={`/contacts/${contactId}`}>← 返回 {labelOf(center)} 详情</Link>
          </span>
        }
        actions={
          <>
            <select
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="input-base"
              style={{ width: 130 }}
            >
              <option value={1}>1 跳</option>
              <option value={2}>2 跳</option>
              <option value={3}>3 跳</option>
              <option value={4}>4 跳</option>
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAdd(true)}
              data-testid="graph-add-relation"
            >
              + 添加关系
            </button>
          </>
        }
      />

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height="auto"
          style={{ display: 'block', background: 'linear-gradient(180deg,#fafbff,#f3f4f8)' }}
          data-testid="graph-svg"
        >
          <circle cx={cx} cy={cy} r={RING2_RADIUS + 40} fill="none" stroke="#e5e7eb" strokeDasharray="2 4" />
          <circle cx={cx} cy={cy} r={RING1_RADIUS + 40} fill="none" stroke="#e5e7eb" strokeDasharray="2 4" />

          {graph.edges.map((e, i) => {
            const ax = e.from_id === contactId ? cx : placedAt[e.from_id]?.x ?? cx;
            const ay = e.from_id === contactId ? cy : placedAt[e.from_id]?.y ?? cy;
            const bx = e.to_id === contactId ? cx : placedAt[e.to_id]?.x ?? cx;
            const by = e.to_id === contactId ? cy : placedAt[e.to_id]?.y ?? cy;
            const color =
              e.relation_type === 'colleague'
                ? '#6366f1'
                : e.relation_type === 'family'
                ? '#ec4899'
                : e.relation_type === 'friend'
                ? '#10b981'
                : '#94a3b8';
            return (
              <g key={i}>
                <line
                  x1={ax}
                  y1={ay}
                  x2={bx}
                  y2={by}
                  stroke={color}
                  strokeWidth={e.depth === 1 ? 2 : 1}
                  strokeDasharray={e.depth === 1 ? undefined : '4 4'}
                  opacity={e.depth === 1 ? 0.85 : 0.5}
                />
                {e.label && (
                  <text
                    x={(ax + bx) / 2}
                    y={(ay + by) / 2}
                    fontSize="11"
                    fill="#475569"
                    textAnchor="middle"
                    style={{ paintOrder: 'stroke', stroke: '#fafbff', strokeWidth: 3 }}
                  >
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          <g>
            <circle cx={cx} cy={cy} r={CENTER_R} fill="#2563eb" stroke="#1e3a8a" strokeWidth={3} />
            <text
              x={cx}
              y={cy + 5}
              fontSize="15"
              fontWeight={700}
              fill="#fff"
              textAnchor="middle"
            >
              {labelOf(center)}
            </text>
          </g>

          {others.map((n) => {
            const p = placedAt[n.id];
            if (!p) return null;
            const isRing1 = ring1.includes(n);
            const url = avatarUrl(n);
            return (
              <g key={n.id} data-testid={`graph-node-${n.id}`}>
                <defs>
                  <clipPath id={`clip-${n.id}`}>
                    <circle cx={p.x} cy={p.y} r={NODE_R} />
                  </clipPath>
                </defs>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R}
                  fill={isRing1 ? '#fff' : '#f8fafc'}
                  stroke={isRing1 ? '#2563eb' : '#cbd5e1'}
                  strokeWidth={2}
                />
                {url && (
                  <image
                    href={url}
                    x={p.x - NODE_R}
                    y={p.y - NODE_R}
                    width={NODE_R * 2}
                    height={NODE_R * 2}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#clip-${n.id})`}
                  />
                )}
                {!url && (
                  <text
                    x={p.x}
                    y={p.y + 4}
                    fontSize="12"
                    fontWeight={600}
                    fill="#0f172a"
                    textAnchor="middle"
                  >
                    {labelOf(n).length > 6 ? labelOf(n).slice(0, 6) + '…' : labelOf(n)}
                  </text>
                )}
                <a href={`/contacts/${n.id}`}>
                  <title>
                    {labelOf(n)}
                    {n.company ? ` · ${n.company}` : ''}
                  </title>
                </a>
              </g>
            );
          })}
        </svg>
      </div>

      <section className="section" style={{ marginTop: 16 }}>
        <h2 className="section__title">关系列表</h2>
        {graph.edges.length === 0 ? (
          <div className="card" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>
            还没有任何关系。点上方「+ 添加关系」开始建立人脉网络。
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <ul style={{ listStyle: 'none', margin: 0 }}>
              {graph.edges.map((e, i) => {
                const involvesCenter = e.from_id === contactId || e.to_id === contactId;
                const otherId = involvesCenter
                  ? e.from_id === contactId
                    ? e.to_id
                    : e.from_id
                  : e.from_id;
                const other = graph.nodes.find((n) => n.id === otherId);
                if (!other) return null;
                return (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {involvesCenter ? (
                      <Link
                        to={`/contacts/${other.id}`}
                        style={{ fontWeight: 600, color: 'var(--text)' }}
                      >
                        {labelOf(other)}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 600 }}>
                        {labelOf(graph.nodes.find((n) => n.id === e.from_id) ?? other)}
                        {' ↔ '}
                        {labelOf(graph.nodes.find((n) => n.id === e.to_id) ?? other)}
                      </span>
                    )}
                    {other.company && involvesCenter && (
                      <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
                        · {other.company}
                      </span>
                    )}
                    <span
                      style={{
                        marginLeft: 'auto',
                        color: 'var(--muted)',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      {e.label ?? e.relation_type} · {e.depth} 跳
                    </span>
                    {involvesCenter && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => {
                          if (confirm(`删除与「${labelOf(other)}」的关系？`)) {
                            removeMutation.mutate(other.id);
                          }
                        }}
                      >
                        删除
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {showAdd && (
        <AddRelationModal
          contactId={contactId}
          knownContactIds={new Set(graph.nodes.map((n) => n.id))}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

function AddRelationModal({
  contactId,
  knownContactIds,
  onClose,
}: {
  contactId: string;
  knownContactIds: Set<string>;
  onClose: () => void;
}) {
  const adapter = useAdapter();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const [otherId, setOtherId] = useState('');
  const [label, setLabel] = useState('');

  const contactsQuery = useQuery({
    queryKey: ['contacts-all-for-graph', userId],
    queryFn: () =>
      adapter.contacts.list({ user_id: userId!, limit: 500 }).then((r) => r.items),
    enabled: !!userId,
  });
  const candidates = (contactsQuery.data ?? []).filter((c) => c.id !== contactId && !knownContactIds.has(c.id));

  const addMutation = useMutation({
    mutationFn: () =>
      adapter.graph.addRelation(contactId, {
        other_contact_id: otherId,
        label: label.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph', contactId] });
      onClose();
    },
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ padding: 24, width: 420, maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 16px 0' }}>添加关系</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label className="input-label">联系人</label>
            <select
              className="input-base"
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
              data-testid="graph-add-other-select"
            >
              <option value="">选择…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nickname ?? c.name ?? '?'}
                  {c.company ? ` · ${c.company}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="input-label">关系备注</label>
            <input
              className="input-base"
              placeholder="例：大学同学、2018 大会认识"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="graph-add-label"
            />
          </div>
        </div>
        {addMutation.isError && (
          <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 'var(--text-sm)' }}>
            {String(addMutation.error?.message ?? '添加失败')}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!otherId || addMutation.isPending}
            onClick={() => addMutation.mutate()}
            data-testid="graph-add-submit"
          >
            {addMutation.isPending ? '添加中…' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useUserId } from '../lib/auth';