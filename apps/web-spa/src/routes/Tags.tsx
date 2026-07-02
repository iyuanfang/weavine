import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag, CreateTagInput } from '../lib/adapter/types';

const PRESET_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#6b7280',
];

function tagColor(tag: Tag): string {
  return tag.color ?? PRESET_COLORS[tag.name.length % PRESET_COLORS.length];
}

export function Tags() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);

  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateTagInput) => adapter.tags.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewName('');
      setNewColor(PRESET_COLORS[0]);
      setShowCreate(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (tagId: string) => adapter.tags.delete(tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !ownerId) return;
    createMutation.mutate({
      owner_id: ownerId,
      name: newName.trim(),
      color: newColor,
    });
  };

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (tagsQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载标签失败: {String(tagsQuery.error)}</div>
      </div>
    );
  }

  const tags = tagsQuery.data ?? [];

  return (
    <div className="page">
      <PageHeader
        title="标签"
        subtitle={`${tags.length} 个 · 给你的联系人分类`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? '取消' : '+ 新建标签'}
          </button>
        }
      />

      {showCreate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="input-label">名称 *</label>
                <input
                  type="text"
                  className="input-base"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：朋友、同事、投资人…"
                  autoFocus
                />
              </div>
              <div>
                <label className="input-label">颜色</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      aria-label={`选择颜色 ${c}`}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: c,
                        border:
                          newColor === c
                            ? '2px solid var(--fg)'
                            : '2px solid transparent',
                        cursor: 'pointer',
                        padding: 0,
                        transition: 'transform 120ms',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreate(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMutation.isPending || !newName.trim()}
                >
                  {createMutation.isPending ? '创建中…' : '创建'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {createMutation.isError && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          创建失败: {String(createMutation.error?.message ?? '未知错误')}
        </div>
      )}

      {tagsQuery.isLoading ? (
        <div className="loading">加载中</div>
      ) : tags.length === 0 ? (
        <div className="empty-state">
          <h3 className="empty-state__title">还没有标签</h3>
          <p className="empty-state__hint">创建第一个标签，给你的联系人分类。</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
          >
            + 新建标签
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="row-card"
              style={{ padding: '12px 16px' }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: tagColor(tag),
                  flexShrink: 0,
                }}
              />
              <span className="row-card__title" style={{ flex: 1, minWidth: 0 }}>
                {tag.name}
              </span>
              <Link
                to={`/tags/${tag.id}`}
                className="btn btn-sm btn-ghost"
              >
                查看
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`确定要删除标签「${tag.name}」吗？`)) {
                    deleteMutation.mutate(tag.id);
                  }
                }}
                disabled={deleteMutation.isPending && deleteMutation.variables === tag.id}
                className="btn btn-sm btn-danger"
                style={{
                  opacity:
                    deleteMutation.isPending && deleteMutation.variables === tag.id ? 0.6 : 1,
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}