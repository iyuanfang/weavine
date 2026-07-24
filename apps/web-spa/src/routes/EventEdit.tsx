import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { CategoryPicker } from '../components/CategoryPicker';
import { SearchablePicker } from '../components/SearchablePicker';
import { EVENT_PRESETS } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import type { Contact, Event, Project, UpdateEventInput } from '../lib/adapter/types';

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return formatLocal(d);
}

function formatLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventEdit() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const userId = useUserId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get('from');

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => adapter.events.get(id),
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    queryFn: () => adapter.contacts.list({ user_id: userId! }),
    enabled: !!userId,
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', userId],
    queryFn: () => adapter.projects.list({ user_id: userId!, archived: 'false', limit: 500 }),
    enabled: !!userId,
  });

  const [title, setTitle] = useState('');
  const [type, setType] = useState(EVENT_PRESETS[0].value);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [contactId, setContactId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [reminderLeadMinutes, setReminderLeadMinutes] = useState<number | null>(null);
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
      setProjectId(e.project_id ?? '');
      setReminderLeadMinutes(e.reminder_lead_minutes ?? null);
      setHydrated(true);
    }
  }, [eventQuery.data, hydrated]);

  useEffect(() => {
    if (!hydrated || !startAt) return;
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) return;
    const inferred = formatLocal(new Date(start.getTime() + 60 * 60 * 1000));
    if (!endAt) {
      setEndAt(inferred);
      return;
    }
    const currentEnd = new Date(endAt);
    if (Number.isNaN(currentEnd.getTime()) || currentEnd.getTime() <= start.getTime()) {
      setEndAt(inferred);
    }
  }, [hydrated, startAt]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateEventInput) => adapter.events.update(input),
    onSuccess: (data) => {
      queryClient.setQueryData<Event>(['event', id], data);
      queryClient.invalidateQueries({ queryKey: ['events'] });
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-events', projectId] });
      }
      navigate(fromParam || '/calendar');
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
      project_id: projectId || null,
      reminder_lead_minutes: reminderLeadMinutes,
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

  const contacts = contactsQuery.data?.items ?? [];
  const projects = projectsQuery.data ?? [];
  const linkedProject = projectId
    ? projects.find((p: Project) => p.id === projectId)
    : null;

  return (
    <div className="page page--narrow">
      <PageHeader title="编辑日程" />

      {linkedProject && (
        <div className="card" style={{ padding: 12, marginBottom: 16, fontSize: 'var(--text-base)' }}>
          <span className="badge" style={{ background: '#eef2ff', color: '#4338ca', marginRight: 8 }}>
            📁 项目
          </span>
          <Link to={`/projects/${linkedProject.id}?from=${encodeURIComponent(fromParam || '/events')}`} style={{ fontWeight: 600 }}>
            {linkedProject.title}
          </Link>
          <span style={{ color: 'var(--muted)', marginLeft: 8 }}>· {linkedProject.stage}</span>
        </div>
      )}

      {updateMutation.isError && (
        <div className="error-banner">
          <div>
            <strong>保存失败</strong>
            <div style={{ marginTop: 2, fontSize: 'var(--text-sm)' }}>
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
                  <SearchablePicker
                    value={projectId}
                    onChange={setProjectId}
                    options={projects.filter((p: Project) => !p.archived_at).map((p: Project) => ({
                      id: p.id,
                      label: p.title,
                      sublabel: p.stage,
                    }))}
                    placeholder="搜索项目…"
                    emptyText="还没有项目"
                  />
                </div>
                <div>
                  <label className="input-label">关联联系人</label>
                  <SearchablePicker
                    value={contactId}
                    onChange={setContactId}
                    options={contacts.map((c: Contact) => ({
                      id: c.id,
                      label: c.nickname ?? c.name ?? '?',
                      sublabel: c.company ?? c.title ?? null,
                    }))}
                    placeholder="搜索联系人…"
                    emptyText="还没有联系人"
                  />
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(fromParam || '/calendar')}
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