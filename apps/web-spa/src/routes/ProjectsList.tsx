import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Project } from '../lib/adapter/types';

const TEMPLATE_LABELS: Record<string, string> = {
  general: '通用项目',
  sales: '销售管线',
  event_prep: '活动筹备',
};

const TEMPLATE_COLORS: Record<string, string> = {
  general: '#6366f1',
  sales: '#f59e0b',
  event_prep: '#10b981',
};

export function ProjectsList() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  const projectsQuery = useQuery({
    queryKey: ['projects', ownerId],
    queryFn: () =>
      adapter.projects.list({
        owner_id: ownerId!,
      }),
    enabled: !!ownerId,
  });

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (projectsQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载失败: {String(projectsQuery.error)}</div>
      </div>
    );
  }

  const projects = projectsQuery.data ?? [];
  const isLoading = projectsQuery.isLoading;

  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <h1 className="page-title">项目</h1>
          <p className="page-subtitle">
            {projects.length > 0
              ? `共 ${projects.length} 个项目`
              : '按模板管理你的项目'}
          </p>
        </div>
        <Link to="/projects/new" className="btn btn-primary">
          + 新建项目
        </Link>
      </div>

      {isLoading ? (
        <div className="loading">加载项目…</div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <h3 className="empty-state__title">还没有项目</h3>
          <p className="empty-state__hint">从一个项目模板开始，管理你的工作流</p>
          <Link to="/projects/new" className="btn btn-primary">
            + 新建项目
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  const templateColor = TEMPLATE_COLORS[p.template] ?? '#6b7280';
  const templateLabel = TEMPLATE_LABELS[p.template] ?? p.template;

  return (
    <Link
      to={`/projects/${p.id}`}
      className="row-card"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: `${templateColor}18`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          📁
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="row-card__title" style={{ fontSize: 14 }}>
              {p.title}
            </span>
            <span
              className="badge"
              style={{
                background: `${templateColor}14`,
                color: templateColor,
                border: `1px solid ${templateColor}30`,
                fontSize: 11,
              }}
            >
              {templateLabel}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span className="row-card__meta" style={{ fontSize: 12 }}>
              阶段: {p.stage}
            </span>
            {p.due_at && (
              <>
                <span className="row-card__meta">·</span>
                <span className="row-card__meta" style={{ fontSize: 12 }}>
                  截止: {new Date(p.due_at).toLocaleDateString('zh-CN')}
                </span>
              </>
            )}
          </div>
        </div>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>→</span>
      </div>
    </Link>
  );
}
