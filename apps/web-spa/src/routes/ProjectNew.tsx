import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import { stageDotStyle } from '../lib/projectStageColor';
import type { CreateProjectInput } from '../lib/adapter/types';

const TEMPLATES = [
  { value: 'general', label: '通用项目' },
  { value: 'sales', label: '销售管线' },
  { value: 'product_dev', label: '产品开发' },
] as const;

export function ProjectNew() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState('general');
  const [stage, setStage] = useState<string>('');
  const [startAt, setStartAt] = useState('');
  const [dueAt, setDueAt] = useState('');

  const stagesQuery = useQuery({
    queryKey: ['project-stages', template],
    queryFn: () => adapter.projects.stages(template),
    enabled: !!template,
    staleTime: Infinity,
  });

  useEffect(() => {
    const list = stagesQuery.data;
    setStage((prev) => {
      if (list && list.length > 0) {
        if (prev && list.includes(prev)) return prev;
        return list[0];
      }
      return '';
    });
  }, [template, stagesQuery.data]);

  const createMutation = useMutation({
    mutationFn: (input: CreateProjectInput) => adapter.projects.create(input),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects', ownerId] });
      navigate(`/projects/${project.id}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !ownerId) return;
    createMutation.mutate({
      owner_id: ownerId,
      title: title.trim(),
      description: description.trim() || null,
      template,
      stage: stage || null,
      start_at: startAt || null,
      due_at: dueAt || null,
    });
  };

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  const stages = stagesQuery.data ?? [];

  return (
    <div className="page page--narrow">
      <div className="page-header">
        <div>
          <h1 className="page-title">新建项目</h1>
          <p className="page-subtitle">选择一个模板开始管理项目</p>
        </div>
      </div>

      {createMutation.isError && (
        <div className="error-banner" role="alert">
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
                <label className="input-label">项目标题 *</label>
                <input
                  className="input-base"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="给项目起个名字"
                  autoFocus
                />
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">开始时间</label>
                  <input
                    className="input-base"
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                  />
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
              {startAt && dueAt && new Date(startAt) > new Date(dueAt) && (
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--warn, #b45309)',
                    background: '#fef3c7',
                    border: '1px solid #fde68a',
                    borderRadius: 6,
                    padding: '6px 10px',
                  }}
                >
                  ⚠ 开始时间晚于截止时间，请确认。
                </div>
              )}
              <div>
                <label className="input-label">模板</label>
                <select
                  className="input-base"
                  style={{ cursor: 'pointer' }}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                >
                  {TEMPLATES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {stages.length > 0 && (
                  <div
                    className="cluster"
                    style={{ marginTop: 8, fontSize: 'var(--text-sm)', color: 'var(--muted)' }}
                  >
                    <span>阶段流程：</span>
                    {stages.map((s, i) => (
                      <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span
                          className="pill pill--colored"
                          style={{
                            '--pill-bg': 'var(--surface-soft, #f3f4f6)',
                            '--pill-border': 'var(--border)',
                            '--pill-fg': 'var(--fg)',
                            fontWeight: 500,
                          } as React.CSSProperties}
                        >
                          {s}
                        </span>
                        {i < stages.length - 1 && (
                          <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>→</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <label className="input-label">起始阶段</label>
                  <select
                    className="input-base"
                    style={{ cursor: 'pointer' }}
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                    disabled={stagesQuery.isLoading || stages.length === 0}
                  >
                    {stages.length === 0 && <option value="">（加载中…）</option>}
                    {stages.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {stage && (
                    <div
                      style={{
                        marginTop: 6,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 'var(--text-sm)',
                        color: 'var(--muted)',
                      }}
                    >
                      <span
                        aria-hidden
                        className="dot dot--sm"
                        style={stageDotStyle(template, stage)}
                      />
                      当前选择：{stage}
                    </div>
                  )}
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
              style={{ minHeight: 80, resize: 'vertical' }}
            />
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/projects')}
          >
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