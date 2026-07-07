import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { CategoryPicker } from '../components/CategoryPicker';
import { SearchablePicker } from '../components/SearchablePicker';
import { ACTION_PRESETS } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import type { Action, Contact, CreateActionInput, Project } from '../lib/adapter/types';

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
  const userId = useUserId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId');
  const fromParam = searchParams.get('from');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('inbox');
  const [priority, setPriority] = useState(0);
  const [category, setCategory] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [contactId, setContactId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>(projectIdParam ?? '');

  useEffect(() => {
    if (projectIdParam) setProjectId(projectIdParam);
  }, [projectIdParam]);

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    queryFn: () => adapter.contacts.list({ user_id: userId! }),
    enabled: !!userId,
  });
  const contacts = contactsQuery.data ?? [];

  const projectsQuery = useQuery({
    queryKey: ['projects', userId],
    queryFn: () => adapter.projects.list({ user_id: userId!, archived: 'false', limit: 500 }),
    enabled: !!userId,
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
    mutationFn: (input: CreateActionInput) => adapter.actions.create(input),
    onSuccess: (created) => {
      queryClient.setQueryData<Action[]>(['actions', userId], (old) => {
        const list = old ?? [];
        if (list.some((a) => a.id === created.id)) return list;
        return [created, ...list];
      });
      queryClient.invalidateQueries({ queryKey: ['actions', userId] });
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-actions', projectId] });
      }
      navigate(fromParam || '/actions');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !userId) return;
    createMutation.mutate({
      user_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      category: category.trim() || null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      contact_id: contactId || null,
      project_id: projectId || null,
    });
  };

  if (!userId) {
    return <div className="loading">正在加载用户…</div>;
  }

  return (
    <div className="page page--narrow">
      <PageHeader
        title={linkedProject ? `为「${linkedProject.title}」新建待办` : '新建待办'}
        subtitle={linkedProject ? '关联到当前项目，便于在项目页追溯' : '一件具体的小事，最容易做完'}
      />

      {linkedProject && (
        <div className="card" style={{ padding: 12, marginBottom: 16, fontSize: 'var(--text-base)' }}>
          <span className="badge" style={{ background: '#eef2ff', color: '#4338ca', marginRight: 8 }}>
            📁 项目
          </span>
          <Link to={`/projects/${linkedProject.id}?from=${encodeURIComponent(fromParam || '/actions')}`} style={{ fontWeight: 600 }}>
            {linkedProject.title}
          </Link>
          <span style={{ color: 'var(--muted)', marginLeft: 8 }}>· {linkedProject.stage}</span>
        </div>
      )}

      {createMutation.isError && (
        <div className="error-banner">
          <div>
            <strong>保存失败</strong>
            <div style={{ marginTop: 2, fontSize: 'var(--text-sm)' }}>
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选"
            />
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(fromParam || '/actions')}>
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