import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Contact, CreateEventInput } from '../lib/adapter/types';

// ── Constants ───────────────────────────────────────

const EVENT_TYPE_OPTIONS = [
  { value: '会议', label: '会议' },
  { value: '聚餐', label: '聚餐' },
  { value: '提醒', label: '提醒' },
  { value: '其他', label: '其他' },
] as const;

// ── Page ────────────────────────────────────────────

export function EventNew() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Form state ────────────────────────────────────

  const [title, setTitle] = useState('');
  const [type, setType] = useState('会议');
  const [start_at, setStartAt] = useState('');
  const [end_at, setEndAt] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [contact_id, setContactId] = useState<string | null>(null);

  // ── Fetch contacts ────────────────────────────────

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });

  const contacts = contactsQuery.data ?? [];

  // ── Create mutation ───────────────────────────────

  const createMutation = useMutation({
    mutationFn: (input: CreateEventInput) => adapter.events.create(input),
    onSuccess: (event) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      navigate(`/events/${event.id}`);
    },
  });

  // ── Submit ────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !start_at || !ownerId) return;

    createMutation.mutate({
      owner_id: ownerId,
      title: title.trim(),
      type,
      start_at: new Date(start_at).toISOString(),
      end_at: end_at ? new Date(end_at).toISOString() : null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      contact_id: contact_id || null,
    });
  };

  const handleCancel = () => {
    navigate(-1);
  };

  // ── Guard ─────────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (contactsQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载联系人失败: {String(contactsQuery.error)}</div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--muted)',
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div className="today-page">
      <div className="section__header">
        <h1 className="section__title">新建日程</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <section className="section">
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <label style={labelStyle}>标题 *</label>
              <input
                style={inputStyle}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="日程标题"
              />
            </div>

            <div>
              <label style={labelStyle}>类型</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {EVENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>开始时间 *</label>
              <input
                style={inputStyle}
                type="datetime-local"
                value={start_at}
                onChange={(e) => setStartAt(e.target.value)}
                required
              />
            </div>

            <div>
              <label style={labelStyle}>结束时间</label>
              <input
                style={inputStyle}
                type="datetime-local"
                value={end_at}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>

            <div>
              <label style={labelStyle}>地点</label>
              <input
                style={inputStyle}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="地点"
              />
            </div>

            <div>
              <label style={labelStyle}>关联联系人</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={contact_id ?? ''}
                onChange={(e) => setContactId(e.target.value || null)}
              >
                <option value="">无</option>
                {contacts.map((c: Contact) => (
                  <option key={c.id} value={c.id}>
                    {c.nickname ?? c.name ?? '?'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Notes */}
        <section className="section">
          <label style={labelStyle}>备注</label>
          <textarea
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="备注…"
          />
        </section>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '8px 16px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            style={{
              padding: '8px 24px',
              border: 'none',
              borderRadius: 8,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: createMutation.isPending ? 0.6 : 1,
            }}
          >
            {createMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}