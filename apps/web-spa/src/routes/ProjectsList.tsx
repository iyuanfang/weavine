import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import { stageDotStyle } from '../lib/projectStageColor';
import type { Project } from '../lib/adapter/types';

const TEMPLATE_LABELS: Record<string, string> = {
  general: '通用项目',
  sales: '销售管线',
  product_dev: '产品开发',
};

const TEMPLATE_COLORS: Record<string, string> = {
  general: '#6366f1',
  sales: '#f59e0b',
  product_dev: '#8b5cf6',
};

const TEMPLATE_FILTERS = [
  { value: 'all', label: '全部', color: '#9ca3af' },
  { value: 'general', label: '通用项目', color: TEMPLATE_COLORS.general },
  { value: 'sales', label: '销售管线', color: TEMPLATE_COLORS.sales },
  { value: 'product_dev', label: '产品开发', color: TEMPLATE_COLORS.product_dev },
] as const;

export function ProjectsList() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  const [search, setSearch] = useState('');
  const [templateFilter, setTemplateFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'done'>('all');

  const projectsQuery = useQuery({
    queryKey: ['projects', ownerId, 'active'],
    queryFn: () =>
      adapter.projects.list({
        owner_id: ownerId!,
        archived: 'false',
      }),
    enabled: !!ownerId,
  });

  const archiveCountsQuery = useQuery({
    queryKey: ['archive', 'counts', ownerId],
    queryFn: () => adapter.archive.counts(ownerId!),
    enabled: !!ownerId,
    refetchOnMount: 'always',
  });

  const projects = projectsQuery.data ?? [];
  const isLoading = projectsQuery.isLoading;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => templateFilter === 'all' || p.template === templateFilter)
      .filter((p) => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'done') return !!p.completed_at;
        return !p.completed_at;
      })
      .filter((p) => {
        if (!q) return true;
        return (
          p.title.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q) ||
          p.stage.toLowerCase().includes(q)
        );
      });
  }, [projects, search, templateFilter, statusFilter]);

  const countsByTemplate = useMemo(() => {
    return TEMPLATE_FILTERS.reduce<Record<string, number>>((acc, t) => {
      acc[t.value] =
        t.value === 'all'
          ? projects.length
          : projects.filter((p) => p.template === t.value).length;
      return acc;
    }, {});
  }, [projects]);

  const countsByStatus = useMemo(() => ({
    all: projects.length,
    active: projects.filter((p) => !p.completed_at).length,
    done: projects.filter((p) => !!p.completed_at).length,
  }), [projects]);

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

  const panel = (
    <>
      <div className="filter-panel__section">
        <input
          type="text"
          className="input-base"
          placeholder="🔍 搜索项目…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="filter-panel__divider" />

      <div className="filter-panel__section">
        <div className="filter-panel__title">状态</div>
        {[
          { value: 'all', label: '全部', color: '#9ca3af' },
          { value: 'active', label: '进行中', color: TEMPLATE_COLORS.general },
          { value: 'done', label: '已完成', color: '#16a34a' },
        ].map((opt) => {
          const active = statusFilter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value as typeof statusFilter)}
              className={`filter-panel__item ${active ? 'filter-panel__item--active' : ''}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="filter-panel__item-dot"
                  style={{ background: opt.color }}
                />
                <span>{opt.label}</span>
              </span>
              <span className="filter-panel__count">
                {countsByStatus[opt.value as keyof typeof countsByStatus] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="filter-panel__divider" />

      <div className="filter-panel__section">
        <div className="filter-panel__title">模板</div>
        {TEMPLATE_FILTERS.map((t) => {
          const active = templateFilter === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTemplateFilter(t.value)}
              className={`filter-panel__item ${active ? 'filter-panel__item--active' : ''}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="filter-panel__item-dot"
                  style={{ background: t.color }}
                />
                <span>{t.label}</span>
              </span>
              <span className="filter-panel__count">
                {countsByTemplate[t.value] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="filter-panel__divider" />

      <div className="filter-panel__section">
        <Link
          to="/archive"
          className="filter-panel__item"
          style={{ opacity: 0.7 }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📦</span>
            <span>已归档 {archiveCountsQuery.data?.project ?? 0} 项</span>
          </span>
          <span aria-hidden>查看 →</span>
        </Link>
      </div>
    </>
  );

  return (
    <div className="page">
      <PageHeader
        title="项目"
        subtitle={`共 ${projects.length} 个项目 · 筛选后 ${filtered.length} 个`}
        actions={
          <Link to="/projects/new" className="btn btn-primary">
            + 新建项目
          </Link>
        }
      />

      <div className="layout-split">
        <aside className="filter-panel">{panel}</aside>

        <div className="layout-split__main">
          {isLoading ? (
            <div className="loading">加载项目…</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <h3 className="empty-state__title">
                {projects.length === 0
                  ? '还没有项目'
                  : '没有匹配的项目'}
              </h3>
              <p className="empty-state__hint">
                {projects.length === 0
                  ? '从一个项目模板开始，管理你的工作流'
                  : '试试切换筛选条件'}
              </p>
              {projects.length === 0 && (
                <Link to="/projects/new" className="btn btn-primary">
                  + 新建项目
                </Link>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {filtered.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>
      </div>
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
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: `${templateColor}18`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-lg)',
          flexShrink: 0,
        }}
      >
        📁
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="row-card__title">{p.title}</span>
          <span
            className="badge"
            style={{
              background: `${templateColor}14`,
              color: templateColor,
              border: `1px solid ${templateColor}30`,
              fontSize: 'var(--text-xs)',
            }}
          >
            {templateLabel}
          </span>
          {p.completed_at && (
            <span
              className="badge"
              style={{
                background: '#dcfce7',
                color: '#15803d',
                fontSize: 'var(--text-xs)',
              }}
            >
              ✅ 已完成
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span
            className="row-card__meta"
            style={{ fontSize: 'var(--text-sm)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            阶段:
            <span
              aria-hidden
              className="dot dot--sm"
              style={{ marginLeft: 2, ...stageDotStyle(p.template, p.stage) }}
            />
            {p.stage}
          </span>
          {p.due_at && (
            <>
              <span className="row-card__meta">·</span>
              <span className="row-card__meta" style={{ fontSize: 'var(--text-sm)' }}>
                截止: {new Date(p.due_at).toLocaleDateString('zh-CN')}
              </span>
            </>
          )}
        </div>
      </div>
      <span style={{ fontSize: 'var(--text-base)', color: 'var(--muted)' }}>→</span>
    </Link>
  );
}