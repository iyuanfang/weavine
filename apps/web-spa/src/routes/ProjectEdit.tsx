import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import { stageDotStyle } from '../lib/projectStageColor';
import type { UpdateProjectInput } from '../lib/adapter/types';

export function ProjectEdit() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const projectQuery = useQuery({
    queryKey: ['project', id],
    queryFn: () => adapter.projects.get(id),
  });

  const stagesQuery = useQuery({
    queryKey: ['project-stages', projectQuery.data?.template ?? ''],
    queryFn: () => adapter.projects.stages(projectQuery.data!.template),
    enabled: !!projectQuery.data?.template,
    staleTime: Infinity,
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState('');
  const [startAt, setStartAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (projectQuery.data && !hydrated) {
      const p = projectQuery.data;
      setTitle(p.title);
      setDescription(p.description ?? '');
      setStage(p.stage);
      setStartAt(p.start_at ?? '');
      setDueAt(p.due_at ?? '');
      setHydrated(true);
    }
  }, [projectQuery.data, hydrated]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateProjectInput) => adapter.projects.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['projects', ownerId] });
      navigate(`/projects/${id}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const patch: UpdateProjectInput = {
      id,
      title: title.trim(),
      description: description.trim() || null,
      stage: stage || null,
      start_at: startAt || null,
      due_at: dueAt || null,
    };
    updateMutation.mutate(patch);
  };

  if (projectQuery.isLoading || !hydrated) {
    return <div className="loading">加载中</div>;
  }

  if (projectQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载项目失败: {String(projectQuery.error)}</div>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <div className="page-header">
        <h1 className="page-title">编辑项目</h1>
      </div>

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
                <label className="input-label">项目标题 *</label>
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
                    fontSize: 12,
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
                <label className="input-label">当前阶段</label>
                <select
                  className="input-base"
                  style={{ cursor: 'pointer' }}
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  disabled={stagesQuery.isLoading}
                >
                  <option value="">保持不变</option>
                  {(stagesQuery.data ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {stage && projectQuery.data && (
                  <div
                    style={{
                      marginTop: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--muted)',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        ...stageDotStyle(projectQuery.data.template, stage),
                      }}
                    />
                    当前选择：{stage}
                  </div>
                )}
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
            onClick={() => navigate(`/projects/${id}`)}
          >
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={updateMutation.isPending || !title.trim()}
          >
            {updateMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}
