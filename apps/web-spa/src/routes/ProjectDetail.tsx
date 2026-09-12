import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { BacklinksPanel } from '../components/BacklinksPanel';
import { stageColor } from '../lib/projectStageColor';
import { avatarBg } from '../lib/contactColor';
import { backTarget } from '../lib/backNavigation';
import { QuickCreateContact } from '../components/QuickCreateContact';
import { GraphTab } from '../components/GraphTab';
import { DetailHeaderCard, EntityIconBadge } from '../components/DetailHeaderCard';

const TEMPLATE_LABELS: Record<string, string> = {
  general: '通用项目',
  sales: '销售管线',
  product_dev: '产品开发',
};

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
  const userId = useUserId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get('from');

  const back = backTarget(fromParam, '/projects');

  // Match ContactDetail/ActionDetail/EventDetail: tab lives in the URL so
  // deep links and back-navigation work consistently. GraphTab owns switching.
  const tab: 'detail' | 'graph' = searchParams.get('tab') === 'graph' ? 'graph' : 'detail';
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
    queryKey: ['project-actions', id, 'active'],
    queryFn: () =>
      adapter.actions.list({
        user_id: userId!,
        project_id: id,
        archived: 'false',
        limit: 100,
      }),
    enabled: !!userId,
  });

  const eventsQuery = useQuery({
    queryKey: ['project-events', id, 'active'],
    queryFn: () =>
      adapter.events.list({
        user_id: userId!,
        project_id: id,
        archived: 'false',
        limit: 100,
      }),
    enabled: !!userId,
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    queryFn: () => adapter.contacts.list({ user_id: userId! }),
    enabled: contactPickerOpen && contactSearch.trim().length === 0 && !!userId,
  });

  const searchQuery = useQuery({
    queryKey: ['contact-search', contactSearch, userId],
    queryFn: () => adapter.search.query(userId!, contactSearch.trim(), 20),
    enabled: contactPickerOpen && contactSearch.trim().length > 0 && !!userId,
  });

  const existingContactIds = new Set((peopleQuery.data ?? []).map((p) => p.contact.id));

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; stage?: string }) =>
      adapter.projects.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['projects', userId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => adapter.projects.delete(id),
    onSuccess: () => {
      // Required: navigate() remounts ProjectsList but the cached
      // ['projects', userId] query is still fresh (staleTime: 30s), so the
      // list would keep showing the deleted row until F5.
      queryClient.invalidateQueries({ queryKey: ['projects', userId] });
      navigate(fromParam || '/projects');
    },
  });

  const addContactMutation = useMutation({
    mutationFn: (vars: { contact_id: string; role: string | null }) =>
      adapter.projectContacts.add(id, vars.contact_id, vars.role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-contacts', id] });
    },
    onError: (err: Error) => {
      // Surface silent errors so user can report them. Previously the mutation
      // would reject with no UI feedback, leading to "clicked add, nothing happened".
      console.error('[project] add contact failed:', err);
      alert(`添加联系人失败：${err?.message ?? '未知错误'}`);
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: (vars: { contact_id: string; role: string | null }) =>
      adapter.projectContacts.add(id, vars.contact_id, vars.role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-contacts', id] });
    },
    onError: (err: Error) => {
      console.error('[project] update role failed:', err);
      alert(`更新角色失败：${err?.message ?? '未知错误'}`);
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
    : (contactsQuery.data?.items ?? []).slice(0, 50).map((c) => ({
        id: c.id,
        nickname: c.nickname,
        company: c.company,
      }));

  return (
    <div className="page">
      <DetailHeaderCard
        icon={<EntityIconBadge>📁</EntityIconBadge>}
        title={project.title}
        badges={
          <>
            <span className="badge badge--muted" style={{ fontSize: 'var(--text-xs)' }}>
              {templateLabel}
            </span>
            {isCompleted && (
              <span className="badge badge--success" style={{ fontSize: 'var(--text-xs)' }}>
                ✅ 已完成
              </span>
            )}
          </>
        }
        meta={
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            开始: {formatDate(project.start_at)}
            {project.due_at && <> · 截止: {formatDate(project.due_at)}</>}
            {project.completed_at && <> · 完成: {formatDate(project.completed_at, true)}</>}
          </span>
        }
        actions={
          <>
            <Link to={back.href} className="btn btn-ghost">
              {back.label}
            </Link>
            <Link
              to={`/projects/${id}/edit?from=${encodeURIComponent(fromParam || `/projects/${id}`)}`}
              className="btn btn-secondary"
            >
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
          </>
        }
      />

      <GraphTab
        center={{ type: 'project', id }}
        creatable={['event', 'action', 'note', 'interaction']}
        detailLabel="详情"
        graphLabel="🕸️ 关系图"
      />

      {tab === 'detail' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {(stages.length > 0 || next) && (
            <div className="card" style={{ padding: 12 }}>
              {stages.length > 0 && (
                <div
                  style={{
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
                            padding: '4px 12px',
                            borderRadius: 20,
                            fontSize: 'var(--text-sm)',
                            fontWeight: isCurrent ? 600 : 400,
                            background: isCurrent
                              ? stageColor(project.template, s)
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
                              width: 18,
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
                <div style={{ marginTop: stages.length > 0 ? 12 : 0 }}>
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
          )}

        <section>
          <div className="section__header">
            <h2 className="section__title">关联联系人</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setContactPickerOpen((v) => !v)}
              >
                {contactPickerOpen ? '关闭' : '+ 添加联系人'}
              </button>
            </div>
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
                <div className="empty-state" style={{ padding: 12, fontSize: 'var(--text-base)' }}>
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
                          <div style={{ fontSize: 'var(--text-base)', fontWeight: 500 }}>
                            {c.nickname}
                          </div>
                          {c.company && (
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                              {c.company}
                            </div>
                          )}
                          {!already && (
                            <div className="cluster cluster--tight" style={{ marginTop: 6 }}>
                              {ROLE_PRESETS.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setDraftRoles({ ...draftRoles, [c.id]: r })}
                                  style={{
                                    fontSize: 'var(--text-xs)',
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
                          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                            已添加
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: 'var(--text-sm)', flexShrink: 0 }}
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
              <div
                style={{
                  borderTop: '1px solid var(--border, #e5e7eb)',
                  marginTop: 10,
                  paddingTop: 10,
                }}
              >
                <QuickCreateContact
                  onCreated={(c) => {
                    addContactMutation.mutate({ contact_id: c.id, role: null });
                  }}
                />
              </div>
            </div>
          )}

          {peopleQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : people.length === 0 ? (
            <div className="empty-state">还没有联系人，点右上角「+ 添加联系人」</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {people.map((entry) => {
                const c = entry.contact;
                const displayName = c.nickname || c.name || '?';
                return (
                <div
                  key={c.id}
                  className="row-card"
                  style={{ flexWrap: 'wrap', gap: '8px 12px', marginBottom: 0 }}
                >
                  <div
                    className="avatar"
                    style={{
                      width: 32,
                      height: 32,
                      fontSize: 13,
                      background: avatarBg(displayName),
                    }}
                  >
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <Link
                    to={`/contacts/${c.id}?from=/projects/${id}`}
                    className="row-card__title"
                    style={{ flex: '0 1 auto', textDecoration: 'none', color: 'var(--fg)' }}
                  >
                    {displayName}
                  </Link>
                  <span
                    className="row-card__meta"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {[c.company, c.title].filter(Boolean).join(' · ')}
                  </span>
                  {editingRoleFor === c.id ? (
                    <div className="cluster cluster--tight" style={{ flexShrink: 0 }}>
                      {ROLE_PRESETS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            updateRoleMutation.mutate({ contact_id: c.id, role: r });
                            setEditingRoleFor(null);
                          }}
                          style={{
                            fontSize: 'var(--text-xs)',
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
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingRoleFor(null);
                        }}
                        style={{
                          fontSize: 'var(--text-xs)',
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
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditingRoleFor(c.id);
                      }}
                      style={{
                        background: '#eef2ff',
                        color: '#4338ca',
                        fontSize: 'var(--text-xs)',
                        cursor: 'pointer',
                        border: '1px solid #e0e7ff',
                        padding: '2px 8px',
                        borderRadius: 999,
                        flexShrink: 0,
                      }}
                      title="点击修改角色"
                    >
                      {entry.role} ✎
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditingRoleFor(c.id);
                      }}
                      style={{
                        fontSize: 'var(--text-xs)',
                        padding: '2px 8px',
                        borderRadius: 999,
                        border: '1px dashed var(--border)',
                        background: 'transparent',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      title="设置角色"
                    >
                      + 角色
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (confirm(`从项目中移除「${displayName}」？`)) {
                        removeContactMutation.mutate(c.id);
                      }
                    }}
                    disabled={removeContactMutation.isPending}
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 'var(--text-sm)', flexShrink: 0 }}
                  >
                    移除
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </section>
      

        <section>
          <div className="section__header">
            <h2 className="section__title">关联待办</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Link
                to={`/actions/new?from=/projects/${id}&projectId=${id}`}
                className="section__view-all"
              >
                + 新建待办
              </Link>
            </div>
          </div>

          {tasksQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : tasks.length === 0 ? (
            <div className="empty-state">还没有待办，点右上角「+ 新建待办」</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {tasks.map((t) => (
                <Link
                  key={t.id}
                  to={`/actions/${t.id}?from=/projects/${id}`}
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
                          fontSize: 'var(--text-base)',
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
                            fontSize: 'var(--text-sm)',
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
                        style={{ fontSize: 'var(--text-xs)', background: '#f3f4f6' }}
                      >
                        优先级: {priorityLabel(t.priority)}
                      </span>
                      <span
                        className="badge"
                        style={{
                          fontSize: 'var(--text-xs)',
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
      

        <section>
          <div className="section__header">
            <h2 className="section__title">关联日程</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Link
                to={`/events/new?from=/projects/${id}&projectId=${id}`}
                className="section__view-all"
              >
                + 新建日程
              </Link>
            </div>
          </div>

          {eventsQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : events.length === 0 ? (
            <div className="empty-state">还没有日程，点右上角「+ 新建日程」</div>
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
                    to={`/events/${e.id}?from=/projects/${id}`}
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
                        <div style={{ fontSize: 'var(--text-base)', fontWeight: 500 }}>
                          {e.title}
                        </div>
                        <div
                          style={{
                            fontSize: 'var(--text-sm)',
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
                        style={{ fontSize: 'var(--text-xs)', background: '#f3f4f6' }}
                      >
                        {e.type}
                      </span>
                    </div>
                  </Link>
                ))}
            </div>
          )}
        </section>
      
        </div>
      )}

      <BacklinksPanel entityType="project" entityId={id} />
    </div>
  );
}