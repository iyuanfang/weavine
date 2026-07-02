import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Contact, UpdateActionInput } from '../lib/adapter/types';

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

export function ActionEdit() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Fetch action ──────────────────────────────────

  const actionQuery = useQuery({
    queryKey: ['action', id],
    queryFn: () => adapter.actions.get(id),
  });

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

  // ── Form state ────────────────────────────────────

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('inbox');
  const [priority, setPriority] = useState(0);
  const [category, setCategory] = useState('');
  const [due_at, setDueAt] = useState('');
  const [contact_id, setContactId] = useState<string | null>(null);
  const [event_id, setEventId] = useState<string | null>(null);

  // Pre-fill form when action loads
  useEffect(() => {
    if (actionQuery.data) {
      const a = actionQuery.data;
      setTitle(a.title);
      setDescription(a.description ?? '');
      setStatus(a.status);
      setPriority(a.priority ?? 0);
      setCategory(a.category ?? '');
      setDueAt(a.due_at ? new Date(a.due_at).toISOString().slice(0, 16) : '');
      setContactId(a.contact_id ?? null);
      setEventId(a.event_id ?? null);
    }
  }, [actionQuery.data]);

  // ── Update mutation ───────────────────────────────

  const updateMutation = useMutation({
    mutationFn: (input: UpdateActionInput) => adapter.actions.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
      queryClient.invalidateQueries({ queryKey: ['action', id] });
      navigate(`/actions/${id}`);
    },
  });

  // ── Submit ────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !ownerId) return;

    updateMutation.mutate({
      id,
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
    navigate(`/actions/${id}`);
  };

  // ── Guard ─────────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (actionQuery.isLoading) {
    return <div className="loading">…</div>;
  }

  if (actionQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载待办失败: {String(actionQuery.error)}</div>
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
        <h1 className="section__title">编辑待办</h1>
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
            disabled={updateMutation.isPending}
            style={{
              padding: '8px 24px',
              border: 'none',
              borderRadius: 8,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: updateMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: updateMutation.isPending ? 0.6 : 1,
            }}
          >
            {updateMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}