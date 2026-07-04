import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';

const TEMPLATE_LABELS: Record<string, string> = {
  general: '通用项目',
  sales: '销售管线',
  event_prep: '活动筹备',
};

type TabKey = 'overview' | 'people' | 'tasks' | 'schedule';

function nextStage(current: string, stages: string[]): string | null {
  const idx = stages.indexOf(current);
  if (idx < 0 || idx >= stages.length - 1) return null;
  return stages[idx + 1];
}

function formatDate(d: string | null | undefined, withTime = false): string {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  if (withTime) return date.toLocaleString('zh-CN', { hour12: false });
  return date.toLocaleDateString('zh-CN');
}

function SummaryCard(props: {
  label: string;
  value: string | number;
  sub?: string;
  cta: string;
  onClick: () => void;
  icon: string;
}) {
  return (
    <button
      type="button"
      className="card"
      onClick={props.onClick}
      style={{
        padding: 16,
        textAlign: 'left',
        border: '1px solid var(--border, #e5e7eb)',
        background: '#fff',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{props.icon}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{props.label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>{props.value}</div>
      {props.sub && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{props.sub}</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--accent, #6366f1)', fontWeight: 500 }}>
        {props.cta} →
      </div>
    </button>
  );
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    inbox: '📥 收件箱',
    open: '🔨 进行中',
    waiting: '⏳ 等待中',
    done: '✅ 已完成',
  };
  return map[s] ?? s;
}

function priorityLabel(p: number): string {
  return (['无', '低', '中', '高'] as const)[p] ?? '—';
}

export function ProjectDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabKey>('overview');
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [draftRoles, setDraftRoles] = useState<Record<string, string>>({});
  const [editingRoleFor, setEditingRoleFor] = useState<string | null>(null);

  const ROLE_PRESETS = ['决策人', '赞助人', '介绍人', '技术顾问', '商务'] as const;

  const projectQuery = useQuery({
    queryKey: ['project', id],
    queryFn: () => adapter.projects.get(id),
  });

  const stagesQuery = useQuery({
    queryKey: ['project-stages', projectQuery.data?.template],
    queryFn: () => adapter.projects.stages(projectQuery.data!.template),
    enabled: !!projectQuery.data,
  });

  const peopleQuery = useQuery({
    queryKey: ['project-contacts', id],
    queryFn: () => adapter.projectContacts.list(id),
  });

  const tasksQuery = useQuery({
    queryKey: ['project-actions', id],
    queryFn: () =>
      adapter.actions.list({ owner_id: ownerId!, project_id: id, limit: 100 }),
    enabled: !!ownerId,
  });

  const eventsQuery = useQuery({
    queryKey: ['project-events', id],
    queryFn: () =>
      adapter.events.list({ owner_id: ownerId!, project_id: id, limit: 100 }),
    enabled: !!ownerId,
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: contactPickerOpen && contactSearch.trim().length === 0 && !!ownerId,
  });

  const searchQuery = useQuery({
    queryKey: ['contact-search', contactSearch, ownerId],
    queryFn: () => adapter.search.query(ownerId!, contactSearch.trim(), 20),
    enabled: contactPickerOpen && contactSearch.trim().length > 0 && !!ownerId,
  });

  const existingContactIds = new Set((peopleQuery.data ?? []).map((p) => p.contact.id));

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; stage?: string }) =>
      adapter.projects.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['projects', ownerId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => adapter.projects.delete(id),
    onSuccess: () => navigate('/projects'),
  });

  const addContactMutation = useMutation({
    mutationFn: (vars: { contact_id: string; role: string | null }) =>
      adapter.projectContacts.add(id, vars.contact_id, vars.role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-contacts', id] });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: (vars: { contact_id: string; role: string | null }) =>
      adapter.projectContacts.add(id, vars.contact_id, vars.role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-contacts', id] });
    },
  });

  const removeContactMutation = useMutation({
    mutationFn: (contact_id: string) =>
      adapter.projectContacts.remove(id, contact_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-contacts', id] });
    },
  });

  const handleAdvance = () => {
    if (!projectQuery.data || !stagesQuery.data) return;
    const next = nextStage(projectQuery.data.stage, stagesQuery.data);
    if (next) updateMutation.mutate({ id, stage: next });
  };

  const handleDelete = () => {
    if (
      confirm(
        '确定要删除这个项目吗？\n关联的待办和日程不会被删除，但会解除与项目的关联。',
      )
    ) {
      deleteMutation.mutate();
    }
  };

  if (projectQuery.isLoading) return <div className="loading">加载中</div>;
  if (projectQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">
          加载项目失败: {String(projectQuery.error)}
        </div>
      </div>
    );
  }

  const project = projectQuery.data!;
  const templateLabel = TEMPLATE_LABELS[project.template] ?? project.template;
  const stages = stagesQuery.data ?? [];
  const currentIdx = stages.indexOf(project.stage);
  const next = nextStage(project.stage, stages);
  const people = peopleQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const isCompleted = !!project.completed_at;

  const candidateContacts = contactSearch.trim()
    ? (searchQuery.data?.contacts ?? []).map((c) => ({
        id: c.id,
        nickname: c.nickname,
        company: c.company,
      }))
    : (contactsQuery.data ?? []).slice(0, 50).map((c) => ({
        id: c.id,
        nickname: c.nickname,
        company: c.company,
      }));

  const taskCounts = {
    total: tasks.length,
    done: tasks.filter((t) => t.status === 'done').length,
    open: tasks.filter((t) => t.status !== 'done').length,
  };

  const upcomingEvents = events
    .filter(
      (e) => new Date(e.start_at).getTime() >= Date.now() - 24 * 60 * 60 * 1000,
    )
    .sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );

  const tabs: { key: TabKey; label: string; count: number | null }[] = [
    { key: 'overview', label: '总览', count: null },
    { key: 'people', label: '联系人', count: people.length },
    { key: 'tasks', label: '待办', count: tasks.length },
    { key: 'schedule', label: '日程', count: events.length },
  ];

  return (
    <div className="page">
      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <h1 className="page-title" style={{ margin: 0 }}>
                {project.title}
              </h1>
              <span
                className="badge"
                style={{ background: '#f3f4f6', color: '#374151', fontSize: 11 }}
              >
                {templateLabel}
              </span>
              {isCompleted && (
                <span
                  className="badge"
                  style={{ background: '#dcfce7', color: '#15803d', fontSize: 11 }}
                >
                  ✅ 已完成
                </span>
              )}
            </div>
            {project.description && (
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 14,
                  color: 'var(--muted)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                }}
              >
                {project.description}
              </p>
            )}
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
              开始: {formatDate(project.start_at)}
              {project.due_at && <> · 截止: {formatDate(project.due_at)}</>}
              {project.completed_at && (
                <> · 完成: {formatDate(project.completed_at, true)}</>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <Link to="/projects" className="btn btn-ghost">
              ← 列表
            </Link>
            <Link to={`/projects/${id}/edit`} className="btn btn-secondary">
              编辑
            </Link>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="btn btn-danger"
              style={{ opacity: deleteMutation.isPending ? 0.6 : 1 }}
            >
              {deleteMutation.isPending ? '删除中…' : '删除'}
            </button>
          </div>
        </div>

        {stages.length > 0 && (
          <div
            style={{
              marginTop: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              flexWrap: 'wrap',
            }}
          >
            {stages.map((s, i) => {
              const isCurrent = i === currentIdx;
              const isPast = i < currentIdx;
              const isFuture = i > currentIdx;
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                  <div
                    style={{
                      padding: '6px 14px',
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: isCurrent ? 600 : 400,
                      background: isCurrent
                        ? 'var(--accent)'
                        : isPast
                          ? '#e0e7ff'
                          : '#f3f4f6',
                      color: isCurrent
                        ? '#fff'
                        : isPast
                          ? 'var(--accent, #6366f1)'
                          : '#9ca3af',
                      border: isFuture ? '1px dashed #d1d5db' : 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s}
                  </div>
                  {i < stages.length - 1 && (
                    <div
                      style={{
                        width: 24,
                        height: 2,
                        background: isPast ? 'var(--accent, #6366f1)' : '#e5e7eb',
                        margin: '0 2px',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {next && (
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={handleAdvance}
              disabled={updateMutation.isPending}
              className="btn btn-primary"
              style={{ opacity: updateMutation.isPending ? 0.6 : 1 }}
            >
              {updateMutation.isPending ? '推进中…' : `推进到下一阶段：${next}`}
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 16,
          borderBottom: '1px solid var(--border, #e5e7eb)',
        }}
      >
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent, #6366f1)' : 'var(--muted)',
                background: 'transparent',
                border: 'none',
                borderBottom: active
                  ? '2px solid var(--accent, #6366f1)'
                  : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {t.label}
              {t.count !== null && (
                <span
                  style={{
                    marginLeft: 6,
                    padding: '1px 6px',
                    fontSize: 11,
                    background: active ? '#eef2ff' : '#f3f4f6',
                    color: active ? 'var(--accent)' : 'var(--muted)',
                    borderRadius: 10,
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          <SummaryCard
            label="联系人"
            value={people.length}
            sub={people.length === 0 ? '项目里最重要的资产' : '已建立关系'}
            cta={people.length === 0 ? '添加联系人' : '查看联系人'}
            onClick={() => setTab('people')}
            icon="👥"
          />
          <SummaryCard
            label="待办进度"
            value={`${taskCounts.done} / ${taskCounts.total}`}
            sub={
              taskCounts.open > 0
                ? `${taskCounts.open} 项进行中`
                : tasks.length > 0
                  ? '全部完成 🎉'
                  : '尚无待办'
            }
            cta="管理待办"
            onClick={() => setTab('tasks')}
            icon="✅"
          />
          <SummaryCard
            label="日程"
            value={upcomingEvents.length}
            sub={
              events.length === 0
                ? '尚无日程'
                : `${events.length} 个总计 · ${upcomingEvents.length} 个即将到来`
            }
            cta="查看日程"
            onClick={() => setTab('schedule')}
            icon="📅"
          />
        </div>
      )}

      {tab === 'people' && (
        <section>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 className="section__title" style={{ margin: 0 }}>
              关联联系人
            </h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setContactPickerOpen((v) => !v)}
            >
              {contactPickerOpen ? '关闭' : '+ 添加联系人'}
            </button>
          </div>

          {contactPickerOpen && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <input
                className="input-base"
                placeholder="搜索联系人（昵称/姓名/公司）…"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                autoFocus
                style={{ marginBottom: 10 }}
              />
              {candidateContacts.length === 0 ? (
                <div className="empty-state" style={{ padding: 16, fontSize: 13 }}>
                  {contactSearch.trim()
                    ? searchQuery.isLoading
                      ? '搜索中…'
                      : '没有匹配结果'
                    : contactsQuery.isLoading
                      ? '加载中…'
                      : '通讯录为空'}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: 6,
                    maxHeight: 320,
                    overflowY: 'auto',
                  }}
                >
                  {candidateContacts.map((c) => {
                    const already = existingContactIds.has(c.id);
                    const draftRole = draftRoles[c.id] ?? '';
                    return (
                      <div
                        key={c.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: already ? '#f9fafb' : '#fff',
                          border: '1px solid var(--border, #e5e7eb)',
                          opacity: already ? 0.6 : 1,
                          gap: 10,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>
                            {c.nickname}
                          </div>
                          {c.company && (
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                              {c.company}
                            </div>
                          )}
                          {!already && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                              {ROLE_PRESETS.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setDraftRoles({ ...draftRoles, [c.id]: r })}
                                  style={{
                                    fontSize: 10,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    border: `1px solid ${draftRole === r ? 'var(--accent)' : 'var(--border)'}`,
                                    background: draftRole === r ? 'var(--accent-soft, #eff6ff)' : 'transparent',
                                    color: draftRole === r ? 'var(--accent)' : 'var(--muted)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {r}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {already ? (
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                            已添加
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: 12, flexShrink: 0 }}
                            onClick={() => {
                              addContactMutation.mutate({
                                contact_id: c.id,
                                role: draftRole.trim() || null,
                              });
                              setDraftRoles({ ...draftRoles, [c.id]: '' });
                            }}
                            disabled={addContactMutation.isPending}
                          >
                            添加
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {peopleQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : people.length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ padding: 32 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
                <div style={{ marginBottom: 12 }}>还没有联系人</div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setContactPickerOpen(true)}
                >
                  添加第一位联系人
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {people.map((entry) => {
                const c = entry.contact;
                return (
                <div key={c.id} className="card" style={{ padding: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Link to={`/contacts/${c.id}`} style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 14, fontWeight: 600 }}>
                          {c.nickname}
                        </span>
                        {editingRoleFor === c.id ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {ROLE_PRESETS.map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => {
                                  updateRoleMutation.mutate({ contact_id: c.id, role: r });
                                  setEditingRoleFor(null);
                                }}
                                style={{
                                  fontSize: 10,
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                  border: `1px solid ${entry.role === r ? 'var(--accent)' : 'var(--border)'}`,
                                  background: entry.role === r ? 'var(--accent-soft, #eff6ff)' : 'transparent',
                                  color: entry.role === r ? 'var(--accent)' : 'var(--muted)',
                                  cursor: 'pointer',
                                }}
                              >
                                {r}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setEditingRoleFor(null)}
                              style={{
                                fontSize: 10,
                                padding: '2px 8px',
                                borderRadius: 999,
                                border: '1px solid var(--border)',
                                background: 'transparent',
                                color: 'var(--muted)',
                                cursor: 'pointer',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ) : entry.role ? (
                          <button
                            type="button"
                            onClick={() => setEditingRoleFor(c.id)}
                            className="badge"
                            style={{
                              background: '#eef2ff',
                              color: '#4338ca',
                              fontSize: 10,
                              cursor: 'pointer',
                              border: '1px solid #e0e7ff',
                            }}
                            title="点击修改角色"
                          >
                            {entry.role} ✎
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingRoleFor(c.id)}
                            style={{
                              fontSize: 10,
                              padding: '2px 8px',
                              borderRadius: 999,
                              border: '1px dashed var(--border)',
                              background: 'transparent',
                              color: 'var(--muted)',
                              cursor: 'pointer',
                            }}
                            title="设置角色"
                          >
                            + 角色
                          </button>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--muted)',
                          marginTop: 2,
                        }}
                      >
                        {c.company ?? '—'}
                        {c.title ? ` · ${c.title}` : ''}
                      </div>
                      {c.tags && c.tags.length > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            marginTop: 4,
                          }}
                        >
                          {c.tags.map((t) => t.name).join(' · ')}
                        </div>
                      )}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`从项目中移除「${c.nickname}」？`)) {
                          removeContactMutation.mutate(c.id);
                        }
                      }}
                      disabled={removeContactMutation.isPending}
                      className="btn btn-ghost"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                    >
                      移除
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'tasks' && (
        <section>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 className="section__title" style={{ margin: 0 }}>
              关联待办
            </h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/actions/new?projectId=${id}`)}
            >
              + 新建待办
            </button>
          </div>

          {tasksQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : tasks.length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ padding: 32 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ marginBottom: 12 }}>还没有待办</div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate(`/actions/new?projectId=${id}`)}
                >
                  创建第一个待办
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {tasks.map((t) => (
                <Link
                  key={t.id}
                  to={`/actions/${t.id}`}
                  className="card"
                  style={{
                    padding: 12,
                    display: 'block',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          textDecoration:
                            t.status === 'done' ? 'line-through' : 'none',
                          color:
                            t.status === 'done' ? 'var(--muted)' : 'inherit',
                        }}
                      >
                        {t.title}
                      </div>
                      {t.due_at && (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--muted)',
                            marginTop: 2,
                          }}
                        >
                          截止: {formatDate(t.due_at, true)}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        className="badge"
                        style={{ fontSize: 10, background: '#f3f4f6' }}
                      >
                        优先级: {priorityLabel(t.priority)}
                      </span>
                      <span
                        className="badge"
                        style={{
                          fontSize: 10,
                          background:
                            t.status === 'done' ? '#dcfce7' : '#eef2ff',
                          color:
                            t.status === 'done' ? '#15803d' : '#4338ca',
                        }}
                      >
                        {statusLabel(t.status)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'schedule' && (
        <section>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 className="section__title" style={{ margin: 0 }}>
              关联日程
            </h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/events/new?projectId=${id}`)}
            >
              + 新建日程
            </button>
          </div>

          {eventsQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : events.length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ padding: 32 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
                <div style={{ marginBottom: 12 }}>还没有日程</div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate(`/events/new?projectId=${id}`)}
                >
                  安排第一个日程
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {events
                .slice()
                .sort(
                  (a, b) =>
                    new Date(a.start_at).getTime() -
                    new Date(b.start_at).getTime(),
                )
                .map((e) => (
                  <Link
                    key={e.id}
                    to={`/events/${e.id}`}
                    className="card"
                    style={{
                      padding: 12,
                      display: 'block',
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>
                          {e.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--muted)',
                            marginTop: 2,
                          }}
                        >
                          {formatDate(e.start_at, true)}
                          {e.end_at && ` – ${formatDate(e.end_at, true)}`}
                          {e.location && ` · ${e.location}`}
                        </div>
                      </div>
                      <span
                        className="badge"
                        style={{ fontSize: 10, background: '#f3f4f6' }}
                      >
                        {e.type}
                      </span>
                    </div>
                  </Link>
                ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}