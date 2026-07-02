import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag, CreateTagInput } from '../lib/adapter/types';

// ── Constants ───────────────────────────────────────

const FALLBACK_TAG_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

function tagColor(tag: Tag): string {
  return tag.color ?? FALLBACK_TAG_COLORS[tag.name.length % FALLBACK_TAG_COLORS.length];
}

// ── Page ────────────────────────────────────────────

export function Tags() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');

  // ── Fetch tags ────────────────────────────────────

  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

  // ── Create mutation ───────────────────────────────

  const createMutation = useMutation({
    mutationFn: (input: CreateTagInput) => adapter.tags.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewName('');
      setNewColor('#3b82f6');
      setShowCreate(false);
    },
  });

  // ── Delete mutation ───────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (tagId: string) => adapter.tags.delete(tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  // ── Submit new tag ────────────────────────────────

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !ownerId) return;

    createMutation.mutate({
      owner_id: ownerId,
      name: newName.trim(),
      color: newColor || null,
    });
  };

  // ── Guards ────────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (tagsQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载标签失败: {String(tagsQuery.error)}</div>
      </div>
    );
  }

  const tags = tagsQuery.data ?? [];

  // ── Render ────────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <h1 className="section__title">标签</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--accent)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {showCreate ? '取消' : '+ 新建标签'}
        </button>
      </div>

      {/* Inline create form */}
      {showCreate && (
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="标签名"
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 14,
              background: '#fff',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            style={{
              width: 40,
              height: 38,
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: 'pointer',
              padding: 2,
              background: '#fff',
            }}
          />
          <button
            type="submit"
            disabled={createMutation.isPending}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: createMutation.isPending ? 0.6 : 1,
            }}
          >
            {createMutation.isPending ? '创建中…' : '添加'}
          </button>
        </form>
      )}

      {/* Tags list */}
      {tagsQuery.isLoading ? (
        <div className="loading">…</div>
      ) : tags.length === 0 ? (
        <div className="empty-state">
          <p>还没有标签，创建一个开始分类。</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="row-card"
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {/* Color dot */}
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: tagColor(tag),
                  flexShrink: 0,
                }}
                title={tag.color ?? ''}
              />

              {/* Name */}
              <span className="row-card__title" style={{ flex: 1, minWidth: 0 }}>
                {tag.name}
              </span>

              {/* View link */}
              <Link
                to={`/tags/${tag.id}`}
                style={{
                  fontSize: 12,
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                查看
              </Link>

              {/* Delete button */}
              <button
                onClick={() => deleteMutation.mutate(tag.id)}
                disabled={deleteMutation.isPending && deleteMutation.variables === tag.id}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 12,
                  cursor:
                    deleteMutation.isPending && deleteMutation.variables === tag.id
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    deleteMutation.isPending && deleteMutation.variables === tag.id
                      ? 0.6
                      : 1,
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