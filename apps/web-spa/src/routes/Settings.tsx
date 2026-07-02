import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
      <div className="today-page">
        <div className="error">加载失败: {String(settingsQuery.error)}</div>
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

  function handleDelete(key: string) {
    deleteMutation.mutate(key);
  }

  return (
    <div className="today-page">
      <div className="section__header">
        <h1 className="section__title">设置</h1>
      </div>

      <button
        className="btn-primary"
        onClick={() => setShowAdd(!showAdd)}
        style={{ marginBottom: 16 }}
      >
        {showAdd ? '取消' : '+ 新建设置'}
      </button>

      {showAdd && (
        <div className="rounded border p-4 space-y-3">
          <div>
            <label className="block text-sm">键名</label>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="例如: reminder_offsets"
              className="input-base w-full mt-1"
            />
          </div>
          <div>
            <label className="block text-sm">值</label>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="例如: 30,1440"
              className="input-base w-full mt-1"
            />
          </div>
          <button className="btn-primary" onClick={handleAdd} disabled={upsertMutation.isPending}>
            {upsertMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      )}

      {settings.length === 0 ? (
        <div className="empty-state">
          <p>还没有设置项</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
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
              onDelete={() => handleDelete(s.key)}
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
    <div className="row-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="row-card__title">{setting.key}</span>
        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="input-base w-full mt-1"
            autoFocus
          />
        ) : (
          <span className="row-card__meta">{setting.value}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
        {isEditing ? (
          <>
            <button className="btn-secondary" onClick={onSaveEdit}>
              保存
            </button>
            <button className="btn-secondary" onClick={onCancelEdit}>
              取消
            </button>
          </>
        ) : (
          <button className="btn-secondary" onClick={onStartEdit}>
            编辑
          </button>
        )}
        <button
          className="btn-secondary"
          onClick={onDelete}
          disabled={isDeleting}
          style={{ color: '#ef4444' }}
        >
          删除
        </button>
      </div>
    </div>
  );
}
