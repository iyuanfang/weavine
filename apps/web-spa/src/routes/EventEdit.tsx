import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { CategoryPicker } from '../components/CategoryPicker';
import { EVENT_PRESETS } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Contact, Event, UpdateEventInput } from '../lib/adapter/types';

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventEdit() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => adapter.events.get(id),
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });

  const [title, setTitle] = useState('');
  const [type, setType] = useState(EVENT_PRESETS[0].value);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [contactId, setContactId] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (eventQuery.data && !hydrated) {
      const e = eventQuery.data;
      setTitle(e.title);
      setType(e.type ?? '会议');
      setStartAt(toLocalInput(e.start_at));
      setEndAt(toLocalInput(e.end_at));
      setLocation(e.location ?? '');
      setNotes(e.notes ?? '');
      setContactId(e.contact_id ?? '');
      setHydrated(true);
    }
  }, [eventQuery.data, hydrated]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateEventInput) => adapter.events.update(input),
    onSuccess: (data) => {
      queryClient.setQueryData<Event>(['event', id], data);
      queryClient.invalidateQueries({ queryKey: ['events'] });
      navigate('/calendar');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startAt) return;
    const patch: UpdateEventInput = {
      id,
      title: title.trim(),
      type,
      start_at: new Date(startAt).toISOString(),
      end_at: endAt ? new Date(endAt).toISOString() : null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      contact_id: contactId || null,
    };
    updateMutation.mutate(patch);
  };

  if (eventQuery.isLoading || contactsQuery.isLoading || !hydrated) {
    return <div className="loading">加载中</div>;
  }

  if (eventQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载日程失败: {String(eventQuery.error)}</div>
      </div>
    );
  }

  const contacts = contactsQuery.data ?? [];

  return (
    <div className="page page--narrow">
      <PageHeader
        title="编辑日程"
      />

      {updateMutation.isError && (
        <div className="error-banner">
          <div>
            <strong>保存失败</strong>
            <div style={{ marginTop: 2, fontSize: 12 }}>
              {String(updateMutation.error?.message ?? '未知错误')}
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
                  autoFocus
                />
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">类型</label>
                  <div style={{ paddingTop: 4 }}>
                    <CategoryPicker
                      value={type}
                      presets={EVENT_PRESETS}
                      onChange={setType}
                    />
                  </div>
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
            />
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/calendar')}
          >
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={updateMutation.isPending || !title.trim() || !startAt}
          >
            {updateMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}