import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Contact, CreateEventInput } from '../lib/adapter/types';

const EVENT_TYPE_OPTIONS = [
  { value: '会议', label: '🤝 会议' },
  { value: '聚餐', label: '🍽 聚餐' },
  { value: '提醒', label: '⏰ 提醒' },
  { value: '生日', label: '🎂 生日' },
  { value: '其他', label: '📌 其他' },
] as const;

export function EventNew() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [type, setType] = useState('会议');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [contactId, setContactId] = useState<string>('');

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });
  const contacts = contactsQuery.data ?? [];

  const createMutation = useMutation({
    mutationFn: (input: CreateEventInput) => adapter.events.create(input),
    onSuccess: (event) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      navigate(`/events/${event.id}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startAt || !ownerId) return;
    createMutation.mutate({
      owner_id: ownerId,
      title: title.trim(),
      type,
      start_at: new Date(startAt).toISOString(),
      end_at: endAt ? new Date(endAt).toISOString() : null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      contact_id: contactId || null,
    });
  };

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  return (
    <div className="page page--narrow">
      <PageHeader
        title="新建日程"
        subtitle="会面、纪念日、deadline"
        back={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate(-1)}
          >
            ← 返回
          </button>
        }
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
                  placeholder="例：跟张三晚饭"
                  autoFocus
                />
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">类型</label>
                  <select
                    className="input-base"
                    style={{ cursor: 'pointer' }}
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
                  <label className="input-label">关联联系人</label>
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
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">开始时间 *</label>
                  <input
                    className="input-base"
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="input-label">结束时间</label>
                  <input
                    className="input-base"
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="input-label">地点</label>
                <input
                  className="input-base"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="可选"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">备注</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <textarea
              className="input-base"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="可选"
            />
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={createMutation.isPending || !title.trim() || !startAt}
          >
            {createMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}