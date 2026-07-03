import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { CreateTagInput, Contact } from '../lib/adapter/types';
import { tagColor } from '../lib/tagColor';

export function Tags() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateTagInput) => adapter.tags.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewName('');
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
  const contacts = contactsQuery.data ?? [];

  const taggedContactIds = new Set<string>();
  for (const c of contacts) {
    for (const t of c.tags) taggedContactIds.add(t.id);
  }
  const usedTagCount = taggedContactIds.size;
  const unusedTagCount = tags.length - usedTagCount;
  const untaggedContactCount = contacts.filter((c: Contact) => c.tags.length === 0).length;

  const panel = (
    <>
      <div className="filter-panel__section">
        <div className="filter-panel__title">统计</div>
        <div
          style={{
            padding: '4px 10px',
            fontSize: 13,
            color: 'var(--fg-soft)',
            lineHeight: 1.6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>标签总数</span>
            <span style={{ fontWeight: 600 }}>{tags.length}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>已使用</span>
            <span style={{ color: 'var(--success)', fontWeight: 500 }}>{usedTagCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>未使用</span>
            <span
              style={{
                color: unusedTagCount > 0 ? 'var(--warn)' : 'var(--muted)',
                fontWeight: unusedTagCount > 0 ? 500 : 400,
              }}
            >
              {unusedTagCount}
            </span>
          </div>
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>未打标签联系人</span>
            <span
              style={{
                color: untaggedContactCount > 0 ? 'var(--warn)' : 'var(--muted)',
                fontWeight: untaggedContactCount > 0 ? 500 : 400,
              }}
            >
              {untaggedContactCount}
            </span>
          </div>
        </div>
      </div>

      <div className="filter-panel__divider" />

      <div className="filter-panel__section">
        <div className="filter-panel__title">提示</div>
        <div
          style={{
            padding: '4px 10px',
            fontSize: 12,
            color: 'var(--muted)',
            lineHeight: 1.6,
          }}
        >
          一个标签可以关联到任意多个联系人，一个联系人也可以勾选多个标签。在联系人详情页可以勾选已有标签或新建。
        </div>
      </div>

      <div className="filter-panel__action">
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? '取消' : '+ 新建标签'}
        </button>
      </div>
    </>
  );

  return (
    <div className="page">
      <PageHeader
        title="标签"
        subtitle={`${tags.length} 个 · ${usedTagCount} 个被使用`}
        actions={
          tags.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowCreate(!showCreate)}
            >
              {showCreate ? '取消' : '+ 新建标签'}
            </button>
          )
        }
      />

      <div className="layout-split">
        <aside className="filter-panel">{panel}</aside>

        <div className="layout-split__main">
          {showCreate && (
            <div className="card" style={{ marginBottom: 16 }}>
              <form onSubmit={handleCreate}>
                <div style={{ display: 'grid', gap: 14 }}>
                  <div>
                    <label className="input-label">名称 *</label>
                    <input
                      className="input-base"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="例如：朋友、同事、投资人…"
                      autoFocus
                    />
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
                <div key={tag.id} className="row-card" style={{ padding: '12px 16px' }}>
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
                  <Link to={`/tags/${tag.id}`} className="btn btn-sm btn-ghost">
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
      </div>
    </div>
  );
}