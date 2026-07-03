import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { CategoryPicker } from '../components/CategoryPicker';
import { ACTION_PRESETS } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Action, Contact, CreateActionInput } from '../lib/adapter/types';

const STATUS_OPTIONS = [
  { value: 'inbox', label: '📥 收件箱' },
  { value: 'open', label: '🔨 进行中' },
  { value: 'waiting', label: '⏳ 等待中' },
  { value: 'done', label: '✅ 已完成' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 0, label: '无' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' },
] as const;

export function ActionNew() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('inbox');
  const [priority, setPriority] = useState(0);
  const [category, setCategory] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [contactId, setContactId] = useState<string>('');
  const [eventId, setEventId] = useState<string>('');

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });
  const contacts = contactsQuery.data ?? [];

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

  const createMutation = useMutation({
    mutationFn: (input: CreateActionInput) => adapter.actions.create(input),
    onSuccess: (created) => {
      queryClient.setQueryData<Action[]>(['actions', ownerId], (old) => {
        const list = old ?? [];
        if (list.some((a) => a.id === created.id)) return list;
        return [created, ...list];
      });
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
      navigate('/actions');
    },
  });

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
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      contact_id: contactId || null,
      event_id: eventId || null,
    });
  };

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  return (
    <div className="page page--narrow">
      <PageHeader
        title="新建待办"
        subtitle="一件具体的小事，最容易做完"
      />

      {createMutation.isError && (
        <div className="error-banner">
          <div>
            <strong>保存失败</strong>
            <div style={{ marginTop: 2, fontSize: 12 }}>
              {String(createMutation.error?.message ?? '未知错误')}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <section className="section">
          <h2 className="section__title">基本信息</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="input-label">标题 *</label>
                <input
                  className="input-base"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="例：给张三发邮件确认下周三晚饭"
                  autoFocus
                />
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">状态</label>
                  <select
                    className="input-base"
                    style={{ cursor: 'pointer' }}
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
                  <label className="input-label">优先级</label>
                  <select
                    className="input-base"
                    style={{ cursor: 'pointer' }}
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
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">分类</label>
                  <div style={{ paddingTop: 4 }}>
                    <CategoryPicker
                      value={category || null}
                      presets={ACTION_PRESETS}
                      onChange={setCategory}
                    />
                  </div>
                </div>
                <div>
                  <label className="input-label">截止时间</label>
                  <input
                    className="input-base"
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">关联</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="input-label">联系人</label>
                <select
                  className="input-base"
                  style={{ cursor: 'pointer' }}
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
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
                <label className="input-label">日程</label>
                <select
                  className="input-base"
                  style={{ cursor: 'pointer' }}
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
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
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">描述</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <textarea
              className="input-base"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="详细描述…"
            />
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/actions')}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={createMutation.isPending || !title.trim()}
          >
            {createMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}