import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Contact, CreateActionInput } from '../lib/adapter/types';

// ── Constants ───────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'inbox', label: '收件箱' },
  { value: 'open', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
] as const;

const PRIORITY_OPTIONS = [
  { value: '0', label: '无' },
  { value: '1', label: '低' },
  { value: '2', label: '中' },
  { value: '3', label: '高' },
] as const;

// ── Page ────────────────────────────────────────────

export function ActionNew() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Form state ────────────────────────────────────

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('inbox');
  const [priority, setPriority] = useState(0);
  const [category, setCategory] = useState('');
  const [due_at, setDueAt] = useState('');
  const [contact_id, setContactId] = useState<string | null>(null);
  const [event_id, setEventId] = useState<string | null>(null);

  // ── Fetch contacts ────────────────────────────────

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });

  const contacts = contactsQuery.data ?? [];

  // ── Fetch events ──────────────────────────────────

  const eventsQuery = useQuery({
    queryKey: ['events', ownerId, 'all'],
    queryFn: () =>
      adapter.events.list({
        owner_id: ownerId!,
        limit: 200,
      }),
    enabled: !!ownerId,
  });

  const events = eventsQuery.data ?? [];

  // ── Create mutation ───────────────────────────────

  const createMutation = useMutation({
    mutationFn: (input: CreateActionInput) => adapter.actions.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
      navigate('/actions');
    },
  });

  // ── Submit ────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !ownerId) return;

    createMutation.mutate({
      owner_id: ownerId,
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      category: category.trim() || null,
      due_at: due_at ? new Date(due_at).toISOString() : null,
      contact_id: contact_id || null,
      event_id: event_id || null,
    });
  };

  const handleCancel = () => {
    navigate(-1);
  };

  // ── Guard ─────────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
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
        <h1 className="section__title">新建待办</h1>
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
                placeholder="待办标题"
              />
            </div>

            <div>
              <label style={labelStyle}>状态</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>优先级</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={String(priority)}
                onChange={(e) => setPriority(Number(e.target.value))}
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>分类</label>
              <input
                style={inputStyle}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="分类标签"
              />
            </div>

            <div>
              <label style={labelStyle}>截止时间</label>
              <input
                style={inputStyle}
                type="datetime-local"
                value={due_at}
                onChange={(e) => setDueAt(e.target.value)}
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

            <div>
              <label style={labelStyle}>关联日程</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={event_id ?? ''}
                onChange={(e) => setEventId(e.target.value || null)}
              >
                <option value="">无</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Description */}
        <section className="section">
          <label style={labelStyle}>描述</label>
          <textarea
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="详细描述…"
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