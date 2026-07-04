import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { CategoryPicker } from '../components/CategoryPicker';
import { EVENT_PRESETS } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Contact, CreateEventInput, Event, Project } from '../lib/adapter/types';

export function EventNew() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId');

  const [title, setTitle] = useState('');
  const [type, setType] = useState(EVENT_PRESETS[0].value);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [contactId, setContactId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>(projectIdParam ?? '');
  const [reminderLeadMinutes, setReminderLeadMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (projectIdParam) setProjectId(projectIdParam);
  }, [projectIdParam]);

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });
  const contacts = contactsQuery.data ?? [];

  const projectsQuery = useQuery({
    queryKey: ['projects', ownerId],
    queryFn: () => adapter.projects.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });
  const projects = projectsQuery.data ?? [];

  const linkedProjectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => adapter.projects.get(projectId!),
    enabled: !!projectId,
  });
  const linkedProject =
    linkedProjectQuery.data ?? (projectId ? projects.find((p: Project) => p.id === projectId) : null);

  const createMutation = useMutation({
    mutationFn: (input: CreateEventInput) => adapter.events.create(input),
    onSuccess: (event) => {
      queryClient.setQueryData<Event>(['event', event.id], event);
      queryClient.invalidateQueries({ queryKey: ['events'] });
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-events', projectId] });
        navigate(`/projects/${projectId}`);
      } else {
        navigate('/calendar');
      }
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
      project_id: projectId || null,
      reminder_lead_minutes: reminderLeadMinutes,
    });
  };

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  return (
    <div className="page page--narrow">
      <PageHeader
        title={linkedProject ? `为「${linkedProject.title}」新建日程` : '新建日程'}
        subtitle={linkedProject ? '关联到当前项目，便于在项目页追溯' : '会面、纪念日、deadline'}
      />

      {linkedProject && (
        <div className="card" style={{ padding: 12, marginBottom: 16, fontSize: 13 }}>
          <span className="badge" style={{ background: '#eef2ff', color: '#4338ca', marginRight: 8 }}>
            📁 项目
          </span>
          <Link to={`/projects/${linkedProject.id}`} style={{ fontWeight: 600 }}>
            {linkedProject.title}
          </Link>
          <span style={{ color: 'var(--muted)', marginLeft: 8 }}>· {linkedProject.stage}</span>
        </div>
      )}

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
                  <label className="input-label">提醒</label>
                  <select
                    className="input-base"
                    style={{ cursor: 'pointer' }}
                    value={reminderLeadMinutes === null ? '' : String(reminderLeadMinutes)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setReminderLeadMinutes(v === '' ? null : Number(v));
                    }}
                  >
                    <option value="">不提醒</option>
                    <option value="0">准时</option>
                    <option value="5">提前 5 分钟</option>
                    <option value="15">提前 15 分钟</option>
                    <option value="30">提前 30 分钟</option>
                    <option value="60">提前 1 小时</option>
                    <option value="1440">提前 1 天</option>
                  </select>
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
              <div className="grid-2">
                <div>
                  <label className="input-label">关联项目</label>
                  <select
                    className="input-base"
                    style={{ cursor: 'pointer' }}
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">无</option>
                    {projects.map((p: Project) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
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
            </div>
          </div>
        </section>

        <section className="section" style={{ marginTop: 14 }}>
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
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/calendar')}>
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