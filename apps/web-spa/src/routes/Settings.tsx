import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import type { ArchiveSummary, Setting } from '../lib/adapter/types';

export function SettingsPage() {
  const adapter = useAdapter();
  const userId = useUserId();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['settings', userId],
    queryFn: () => adapter.settings.list(userId!),
    enabled: !!userId,
  });

  const upsertMutation = useMutation({
    mutationFn: (input: { key: string; value: string }) =>
      adapter.settings.upsert(userId!, input.key, input.value),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', userId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => adapter.settings.delete(userId!, key),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', userId] });
    },
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  if (!userId) {
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

      <CloudSyncPanel />
      <ArchivePanel />

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
        <div className="row-card__title" style={{ fontFamily: 'monospace', fontSize: 'var(--text-base)' }}>
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
function ArchivePanel() {
  const adapter = useAdapter();
  const userId = useUserId();
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ['archive', 'summary', userId],
    queryFn: () => adapter.archive.summary(userId!),
    enabled: !!userId,
    refetchOnMount: 'always',
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['archive'] });
    queryClient.invalidateQueries({ queryKey: ['actions'] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  const bulkUnarchiveMutation = useMutation({
    mutationFn: async (entity: 'action' | 'event' | 'project') =>
      adapter.archive.bulkUnarchive(userId!, entity),
    onSuccess: invalidateAll,
  });

  if (!userId) return null;

  const summary: ArchiveSummary | undefined = summaryQuery.data;

  const entityRows: Array<{
    key: 'action' | 'event' | 'project';
    label: string;
    rule: string;
    total: number;
    recent: number;
  }> = [
    { key: 'action', label: '待办', rule: '已完成超过 1 天', total: summary?.action_count ?? 0, recent: summary?.action_30d ?? 0 },
    { key: 'event', label: '日程', rule: '已结束（按结束时间）', total: summary?.event_count ?? 0, recent: summary?.event_30d ?? 0 },
    { key: 'project', label: '项目', rule: '进入终止阶段并超过 7 天', total: summary?.project_count ?? 0, recent: summary?.project_30d ?? 0 },
  ];

  const totalRecent = (summary?.action_30d ?? 0) + (summary?.event_30d ?? 0) + (summary?.project_30d ?? 0);
  const totalAll = (summary?.action_count ?? 0) + (summary?.event_count ?? 0) + (summary?.project_count ?? 0);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>📦 数据整理 — 自动归档</h3>
        <Link to="/archive" style={{ fontSize: 'var(--text-sm)' }}>查看所有归档 →</Link>
      </div>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '4px 0 12px', lineHeight: 1.6 }}>
        应用每次启动时会扫描一次。命中的条目会在列表中隐藏，集中到 <Link to="/archive">归档页</Link>，不会丢失 — 取消归档即可恢复。
      </p>
      <table style={{ width: '100%', fontSize: 'var(--text-base)', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px' }}>类型</th>
            <th style={{ padding: '6px 8px' }}>规则</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>累计</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>30 天内</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {entityRows.map((row) => (
            <tr key={row.key} style={{ borderTop: '1px solid var(--border, #f1f1f1)' }}>
              <td style={{ padding: '8px' }}>{row.label}</td>
              <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{row.rule}</td>
              <td style={{ padding: '8px', textAlign: 'right' }}>{row.total}</td>
              <td style={{ padding: '8px', textAlign: 'right', fontWeight: row.recent > 0 ? 600 : 400 }}>{row.recent}</td>
              <td style={{ padding: '8px', textAlign: 'right' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={bulkUnarchiveMutation.isPending || row.recent === 0}
                  onClick={() => {
                    if (confirm(`确定恢复最近 30 天的 ${row.recent} 个已归档${row.label}？`)) {
                      bulkUnarchiveMutation.mutate(row.key);
                    }
                  }}
                  style={{ fontSize: 'var(--text-xs)', padding: '3px 8px' }}
                >
                  全部恢复
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '12px 0 0' }}>
        合计 {totalAll} 项归档，最近 30 天 {totalRecent} 项。
      </p>
    </div>
  );
}

function CloudSyncPanel() {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const statusQuery = useQuery({
    queryKey: ['cloud-status'],
    queryFn: () => adapter.cloud.status(),
    enabled: isTauriRuntime,
    refetchInterval: 10_000,
  });

  const loginMutation = useMutation({
    mutationFn: (input: { serverUrl: string; email: string; password: string }) =>
      adapter.cloud.login({
        server_url: input.serverUrl,
        email: input.email,
        password: input.password,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cloud-status'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => adapter.cloud.logout(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cloud-status'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => adapter.cloud.syncNow(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['cloud-status'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      console.log('[cloud sync] result:', result);
    },
  });

  const [serverUrl, setServerUrl] = useState('https://weavine.financialagent.cc');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (!isTauriRuntime) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>
          ☁️ 云同步
        </h3>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '8px 0 0' }}>
          仅在桌面端可用 — Web 版直接使用服务端数据。
        </p>
      </div>
    );
  }

  const status = statusQuery.data;
  const linked = status?.linked ?? false;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>
          ☁️ 云同步
        </h3>
        <span
          className="badge"
          style={{
            background: linked ? 'var(--accent-soft, #d1fae5)' : '#f3f4f6',
            color: linked ? 'var(--accent, #059669)' : 'var(--text-muted)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {linked ? '● 已连接' : '○ 未连接'}
        </span>
      </div>

      {statusQuery.isError && (
        <div className="error-banner" style={{ fontSize: 'var(--text-sm)' }}>
          查询云状态失败: {String(statusQuery.error)}
        </div>
      )}

      {linked && status ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.7 }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>账号:</span>{' '}
              <strong>{status.user_email ?? '(未知)'}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>服务器:</span>{' '}
              <code style={{ fontSize: 'var(--text-xs)' }}>{status.server_url}</code>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>上次拉取:</span> rev {status.last_pulled_revision} ·{' '}
              <span style={{ color: 'var(--text-muted)' }}>上次推送:</span> rev {status.last_pushed_revision}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              style={{ opacity: syncMutation.isPending ? 0.6 : 1 }}
            >
              {syncMutation.isPending ? '同步中…' : '🔄 立即同步'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (confirm('确定要断开云连接？本地数据保留，不会删除。')) {
                  logoutMutation.mutate();
                }
              }}
              disabled={logoutMutation.isPending}
              style={{ opacity: logoutMutation.isPending ? 0.6 : 1 }}
            >
              断开连接
            </button>
          </div>

          {syncMutation.data && (
            <div
              className="card"
              style={{
                padding: 10,
                fontSize: 'var(--text-sm)',
                background: 'var(--accent-soft, #ecfdf5)',
              }}
            >
              ✓ 同步完成 — 推送 {syncMutation.data.pushed} · 拉取 {syncMutation.data.pulled} · 冲突{' '}
              {syncMutation.data.conflicts}
            </div>
          )}
          {syncMutation.isError && (
            <div className="error-banner" style={{ fontSize: 'var(--text-sm)' }}>
              同步失败: {String(syncMutation.error)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            连接云账号，同步数据到 https://weavine.financialagent.cc。第一次连接会从云端拉取所有数据到本地。
          </p>
          <div>
            <label className="input-label">服务器地址</label>
            <input
              className="input-base"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://weavine.financialagent.cc"
            />
          </div>
          <div>
            <label className="input-label">邮箱</label>
            <input
              className="input-base"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="input-label">密码</label>
            <input
              className="input-base"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {loginMutation.isError && (
            <div className="error-banner" style={{ fontSize: 'var(--text-sm)' }}>
              登录失败: {String(loginMutation.error)}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                loginMutation.mutate({ serverUrl: serverUrl.trim(), email: email.trim(), password })
              }
              disabled={loginMutation.isPending || !email.trim() || !password || !serverUrl.trim()}
            >
              {loginMutation.isPending ? '连接中…' : '连接云账号'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
