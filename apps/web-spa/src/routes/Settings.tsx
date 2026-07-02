import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Setting } from '../lib/adapter/types';

export function SettingsPage() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['settings', ownerId],
    queryFn: () => adapter.settings.list(ownerId!),
    enabled: !!ownerId,
  });

  const upsertMutation = useMutation({
    mutationFn: (input: { key: string; value: string }) =>
      adapter.settings.upsert(ownerId!, input.key, input.value),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', ownerId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => adapter.settings.delete(ownerId!, key),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', ownerId] });
    },
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (settingsQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载失败: {String(settingsQuery.error)}</div>
      </div>
    );
  }

  const settings = settingsQuery.data ?? [];

  function handleAdd() {
    if (!newKey.trim()) return;
    upsertMutation.mutate({ key: newKey.trim(), value: newValue.trim() });
    setNewKey('');
    setNewValue('');
    setShowAdd(false);
  }

  function startEdit(key: string, value: string) {
    setEditingKey(key);
    setEditValue(value);
  }

  function saveEdit() {
    if (editingKey) {
      upsertMutation.mutate({ key: editingKey, value: editValue.trim() });
    }
    setEditingKey(null);
    setEditValue('');
  }

  return (
    <div className="page">
      <PageHeader
        title="设置"
        subtitle={`${settings.length} 项 · 键值对存储`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAdd(!showAdd)}
          >
            {showAdd ? '取消' : '+ 新建设置'}
          </button>
        }
      />

      {showAdd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label className="input-label">键名 *</label>
              <input
                className="input-base"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="例如 reminder_offsets"
                autoFocus
              />
            </div>
            <div>
              <label className="input-label">值</label>
              <input
                className="input-base"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="例如 30,1440"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={upsertMutation.isPending || !newKey.trim()}
              >
                {upsertMutation.isPending ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsQuery.isLoading ? (
        <div className="loading">加载中</div>
      ) : settings.length === 0 ? (
        <div className="empty-state">
          <h3 className="empty-state__title">还没有设置项</h3>
          <p className="empty-state__hint">键值对配置，应用启动时读取</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAdd(true)}
          >
            + 新建设置
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {settings.map((s) => (
            <SettingRow
              key={s.id}
              setting={s}
              editingKey={editingKey}
              editValue={editValue}
              setEditValue={setEditValue}
              onStartEdit={() => startEdit(s.key, s.value)}
              onSaveEdit={saveEdit}
              onCancelEdit={() => setEditingKey(null)}
              onDelete={() => {
                if (confirm(`确定要删除「${s.key}」吗？`)) {
                  deleteMutation.mutate(s.key);
                }
              }}
              isDeleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  setting,
  editingKey,
  editValue,
  setEditValue,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  isDeleting,
}: {
  setting: Setting;
  editingKey: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const isEditing = editingKey === setting.key;

  return (
    <div className="row-card" style={{ padding: '12px 16px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-card__title" style={{ fontFamily: 'monospace', fontSize: 13 }}>
          {setting.key}
        </div>
        {isEditing ? (
          <input
            type="text"
            className="input-base"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            style={{ marginTop: 6 }}
            autoFocus
          />
        ) : (
          <div className="row-card__meta" style={{ marginTop: 2 }}>
            {setting.value}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {isEditing ? (
          <>
            <button type="button" onClick={onSaveEdit} className="btn btn-sm btn-primary">
              保存
            </button>
            <button type="button" onClick={onCancelEdit} className="btn btn-sm btn-secondary">
              取消
            </button>
          </>
        ) : (
          <button type="button" onClick={onStartEdit} className="btn btn-sm btn-secondary">
            编辑
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={isDeleting}
          className="btn btn-sm btn-danger"
          style={{ opacity: isDeleting ? 0.6 : 1 }}
        >
          删除
        </button>
      </div>
    </div>
  );
}