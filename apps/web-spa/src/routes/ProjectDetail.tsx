import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';

const TEMPLATE_LABELS: Record<string, string> = {
  general: '通用项目',
  sales: '销售管线',
  event_prep: '活动筹备',
};

const TEMPLATE_STAGES: Record<string, string[]> = {
  general: ['计划', '进行中', '已完成'],
  sales: ['线索', '沟通', '报价', '中标', '丢单'],
  event_prep: ['筹备中', '进行中', '已收尾'],
};

function nextStage(current: string, stages: string[]): string | null {
  const idx = stages.indexOf(current);
  if (idx < 0 || idx >= stages.length - 1) return null;
  return stages[idx + 1];
}

export function ProjectDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const projectQuery = useQuery({
    queryKey: ['project', id],
    queryFn: () => adapter.projects.get(id),
  });

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
    onSuccess: () => {
      navigate('/projects');
    },
  });

  const handleAdvance = () => {
    if (!projectQuery.data) return;
    const stages = TEMPLATE_STAGES[projectQuery.data.template] ?? [];
    const next = nextStage(projectQuery.data.stage, stages);
    if (next) {
      updateMutation.mutate({ id, stage: next });
    }
  };

  const handleDelete = () => {
    if (confirm('确定要删除这个项目吗？此操作不可恢复。')) {
      deleteMutation.mutate();
    }
  };

  if (projectQuery.isLoading) {
    return <div className="loading">加载中</div>;
  }

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
  const stages = TEMPLATE_STAGES[project.template] ?? [];
  const currentIdx = stages.indexOf(project.stage);
  const next = nextStage(project.stage, stages);

  return (
    <div className="page">
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 className="page-title" style={{ margin: 0 }}>
                {project.title}
              </h1>
              <span
                className="badge"
                style={{
                  background: '#f3f4f6',
                  color: '#374151',
                  fontSize: 11,
                }}
              >
                {templateLabel}
              </span>
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

        {/* Stage pipeline */}
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
                <div
                  key={s}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      padding: '6px 14px',
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: isCurrent ? 600 : 400,
                      background: isCurrent
                        ? 'var(--accent)'
                        : isPast
                          ? 'var(--accent-light, #e0e7ff)'
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

      {project.completed_at && (
        <section className="section">
          <h2 className="section__title">完成信息</h2>
          <div className="card" style={{ marginTop: 10, padding: 16 }}>
            <div style={{ fontSize: 14 }}>
              完成时间: {new Date(project.completed_at).toLocaleString('zh-CN')}
            </div>
          </div>
        </section>
      )}

      {project.start_at && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>
          开始: {new Date(project.start_at).toLocaleDateString('zh-CN')}
          {project.due_at && (
            <> · 截止: {new Date(project.due_at).toLocaleDateString('zh-CN')}</>
          )}
        </div>
      )}

      {/* Placeholder sections */}
      <section className="section">
        <h2 className="section__title">相关待办</h2>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="empty-state" style={{ padding: 16 }}>
            0 个待办
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">相关日程</h2>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="empty-state" style={{ padding: 16 }}>
            0 个日程
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">相关联系人</h2>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="empty-state" style={{ padding: 16 }}>
            0 个联系人
          </div>
        </div>
      </section>
    </div>
  );
}
