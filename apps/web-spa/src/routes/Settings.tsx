import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import type {
  ArchiveSummary,
  CreateContactInput,
  CreateEventInput,
  CreateActionInput,
  CreateInteractionInput,
  CreateReminderInput,
  Contact,
  Tag,
  Event,
  Action,
  Interaction,
  Reminder,
} from '../lib/adapter/types';

const isWebRuntime =
  typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window);

export function SettingsPage() {
  const userId = useUserId();

  if (!userId) {
    return <div className="loading">正在加载用户…</div>;
  }

  return (
    <div className="page">
      <PageHeader
        title="设置"
        actions={
          isWebRuntime ? (
            <Link to="/settings/api-keys" className="btn">
              API 密钥
            </Link>
          ) : null
        }
      />

      <CloudSyncPanel />
      <ArchivePanel />
      <BackupRestorePanel />
      <ConvertFormatsPanel />
    </div>
  );
}

function ConvertFormatsPanel() {
  const adapter = useAdapter();
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const formatsQuery = useQuery({
    queryKey: ['convert-supported-formats'],
    queryFn: () => adapter.md.convertSupportedFormats(),
    enabled: isTauriRuntime,
  });
  if (!isTauriRuntime) return null;
  const formats = formatsQuery.data ?? [];
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>
        📄 支持的非 .md 格式
      </h3>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '6px 0 12px', lineHeight: 1.6 }}>
        .md 编辑器可打开并转换下列格式。打开时自动转成 markdown，保存到同目录的 <code>&lt;name&gt;.md</code>，原文件不会修改。
      </p>
      {formatsQuery.isPending ? (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>加载中…</div>
      ) : formatsQuery.isError ? (
        <div className="error-banner" style={{ fontSize: 'var(--text-sm)' }}>
          查询失败: {String(formatsQuery.error)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {formats.map((f) => (
            <span
              key={f.extension}
              className="badge"
              title={f.via_markitdown ? '通过 markitdown 转换' : '直接读取'}
              style={{
                background: 'var(--accent-soft, #e0f2fe)',
                color: 'var(--accent, #075985)',
                fontSize: 'var(--text-xs)',
                padding: '2px 8px',
                borderRadius: 4,
              }}
            >
              .{f.extension} · {f.label}
            </span>
          ))}
        </div>
      )}
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

  // Repair path: clear the push watermark, then sync. Recovers rows that a
  // previous sync skipped because the server rejected their entity kind —
  // the watermark had already moved past them, so they were never retried.
  const repairMutation = useMutation({
    mutationFn: async () => {
      await adapter.cloud.repairRepush();
      return adapter.cloud.syncNow();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['cloud-status'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      console.log('[cloud sync] full re-push result:', result);
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
                if (
                  confirm(
                    '将重置本地推送游标，本次同步会重新上传全部本地数据（幂等覆盖，不会重复创建）。确定继续？',
                  )
                ) {
                  repairMutation.mutate();
                }
              }}
              disabled={repairMutation.isPending || syncMutation.isPending}
              style={{ opacity: repairMutation.isPending ? 0.6 : 1 }}
              title="修复因服务端曾拒收某类数据（如笔记）而被跳过、不再重传的记录"
            >
              {repairMutation.isPending ? '重传中…' : '♻️ 全量重传'}
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

      <AndroidSideloadHint />
    </div>
  );
}

// Android-only: link to GitHub releases page so users can grab the latest
// APK manually. Desktop users get their installers from the same page
// outside the app, so no in-app UI is needed.
function AndroidSideloadHint() {
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const openReleasesPage = useCallback(async () => {
    const url = 'https://github.com/iyuanfang/weavine/releases/latest';
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url, 'browser');
        return;
      }
    } catch {}
    window.open(url, '_blank', 'noopener');
  }, []);
  if (!isAndroid) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-base)', fontWeight: 600 }}>
        📥 获取最新 APK
      </h3>
      <div className="card" style={{ padding: 12, fontSize: 'var(--text-sm)' }}>
        <div style={{ marginBottom: 8 }}>
          Android 端无内置更新器，请前往 GitHub Releases 下载最新 APK 并手动安装。
        </div>
        <button type="button" className="btn btn-primary" onClick={openReleasesPage}>
          打开 Releases 页面
        </button>
      </div>
    </div>
  );
}

// Backup / Restore — full-data JSON export and import.
//
// File shape matches the legacy Next.js export endpoint (see
// `c60084e:src/app/api/export/route.ts`) so users migrating from
// the old web stack can drop their existing `prm-export-*.json`
// straight into this dialog. Projects are intentionally NOT
// exported — they aren't in the legacy schema either, and
// downstream event/action refs to projects are reset on import.
// ──────────────────────────────────────────────

interface ExportPayload {
  exportedAt: string;
  counts: {
    contacts: number;
    tags: number;
    events: number;
    interactions: number;
    actions: number;
    reminders: number;
  };
  settings: Record<string, string>;
  contacts: Contact[];
  tags: Tag[];
  events: Event[];
  interactions: Interaction[];
  actions: Action[];
  reminders: Reminder[];
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = new Array(items.length);
  let cursor = 0;
  const take = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      try {
        const value = await worker(items[idx]);
        results[idx] = { status: 'fulfilled', value };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  };
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    () => take(),
  );
  await Promise.all(lanes);
  return results;
}

function BackupRestorePanel() {
  const adapter = useAdapter();
  const userId = useUserId();
  const queryClient = useQueryClient();

  const exportInputRef = useRef<HTMLAnchorElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [progress, setProgress] = useState<{
    phase: string;
    done: number;
    total: number;
  } | null>(null);

  if (!userId) return null;
  // Capture the narrowed id into a const so closures (async
  // functions, callbacks) see it as `string` rather than the
  // `string | null` returned by useUserId() — TS doesn't propagate
  // narrowing across function boundaries.
  const uid: string = userId;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['tags'] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['interactions'] });
    queryClient.invalidateQueries({ queryKey: ['actions'] });
    queryClient.invalidateQueries({ queryKey: ['reminders'] });
    queryClient.invalidateQueries({ queryKey: ['settings', uid] });
  };

  // Export a limit well beyond realistic data sizes so export captures
  // every contact, event, interaction, action, and reminder in one call.
  const ALL_LIMIT = 1_000_000;

  async function handleExport() {
    setBusy('export');
    try {
      const [
        contacts,
        tags,
        events,
        interactions,
        actions,
        reminders,
        settingsArr,
      ] = await Promise.all([
        adapter.contacts.list({
          user_id: uid,
          search: null,
          tag_id: null,
          importance: null,
          limit: ALL_LIMIT,
        }),
        adapter.tags.list(uid),
        adapter.events.list({ user_id: uid, limit: ALL_LIMIT }),
        adapter.interactions.list({ user_id: uid, limit: ALL_LIMIT }),
        adapter.actions.list({ user_id: uid, limit: ALL_LIMIT }),
        adapter.reminders.list({ user_id: uid, limit: ALL_LIMIT }),
        adapter.settings.list(uid),
      ]);

      const settings: Record<string, string> = {};
      for (const s of settingsArr) settings[s.key] = s.value;

       const payload: ExportPayload = {
        exportedAt: new Date().toISOString(),
        counts: {
          contacts: contacts.items.length,
          tags: tags.length,
          events: events.length,
          interactions: interactions.length,
          actions: actions.length,
          reminders: reminders.length,
        },
        settings,
        contacts: contacts.items,
        tags,
        events,
        interactions,
        actions,
        reminders,
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = exportInputRef.current ?? document.createElement('a');
      a.href = url;
      a.download = `prm-export-${payload.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`导出失败: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleImportFile(file: File) {
    setBusy('import');
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as Partial<ExportPayload>;

      // Minimal schema validation — accept either the full legacy
      // shape or just the entity arrays we actually consume.
      const ok =
        raw &&
        Array.isArray(raw.contacts) &&
        Array.isArray(raw.tags) &&
        Array.isArray(raw.events) &&
        Array.isArray(raw.interactions) &&
        Array.isArray(raw.actions) &&
        Array.isArray(raw.reminders);
      if (!ok) {
        alert(
          '文件格式不正确 — 必须包含 contacts / tags / events / interactions / actions / reminders 数组。',
        );
        return;
      }

      const counts = {
        contacts: raw.contacts!.length,
        tags: raw.tags!.length,
        events: raw.events!.length,
        interactions: raw.interactions!.length,
        actions: raw.actions!.length,
        reminders: raw.reminders!.length,
      };
      const settingsCount = raw.settings ? Object.keys(raw.settings).length : 0;
      const summary = `将导入 ${counts.contacts} 个联系人, ${counts.tags} 个标签, ${counts.events} 个日程, ${counts.interactions} 条互动, ${counts.actions} 个待办, ${counts.reminders} 个提醒, ${settingsCount} 项设置。是否继续？`;
      if (!confirm(summary)) return;

      // Phase 1 — tags first; build a name → new-id map so contacts
      // can reference them. Tauri regenerates IDs on create, so the
      // legacy IDs in the export file cannot be preserved.
      setProgress({ phase: '标签', done: 0, total: counts.tags });
      const tagNameToId = new Map<string, string>();
      const tagResults = await runWithConcurrency(raw.tags!, 5, async (t) => {
        const created = await adapter.tags.create({ user_id: uid, name: t.name });
        tagNameToId.set(t.name, created.id);
        return created;
      });
      const tagsFailed = tagResults.filter((r) => r.status === 'rejected').length;

      // Phase 2 — contacts. The legacy Next.js export nests tags as
      // `[{ tag: { id, name } }]`; the Tauri export emits a flat
      // `[{ id, name }]` array. Accept either.
      setProgress({ phase: '联系人', done: 0, total: counts.contacts });
      const contactNicknameToId = new Map<string, string>();
      const contactResults = await runWithConcurrency(raw.contacts!, 5, async (c) => {
        const input: CreateContactInput = {
          user_id: uid,
          nickname: c.nickname,
          name: c.name ?? null,
          company: c.company ?? null,
          title: c.title ?? null,
          address: c.address ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          wechat: c.wechat ?? null,
          importance: c.importance ?? null,
        };
        const tagIds: string[] = [];
        if (Array.isArray(c.tags)) {
          for (const entry of c.tags) {
            const name =
              (entry as { name?: string }).name ??
              (entry as { tag?: { name?: string } }).tag?.name;
            if (name && tagNameToId.has(name)) {
              tagIds.push(tagNameToId.get(name)!);
            }
          }
        }
        if (tagIds.length > 0) input.tag_ids = tagIds;
        const created = await adapter.contacts.create(input);
        contactNicknameToId.set(created.nickname, created.id);
        return created;
      });
      const contactsFailed = contactResults.filter((r) => r.status === 'rejected').length;
      setProgress({ phase: '联系人', done: counts.contacts, total: counts.contacts });

      // Phase 3 — events, interactions, actions, reminders. These
      // reference contacts by nickname (the only stable cross-table
      // key in the export). Project refs are dropped because
      // projects aren't part of the legacy export payload.
      setProgress({ phase: '日程', done: 0, total: counts.events });
      const eventResults = await runWithConcurrency(raw.events!, 5, async (e) => {
        const input: CreateEventInput = {
          user_id: uid,
          title: e.title,
          type: e.type,
          start_at: e.start_at,
          end_at: e.end_at ?? null,
          location: e.location ?? null,
          contact_id: e.contact_nickname
            ? contactNicknameToId.get(e.contact_nickname) ?? null
            : null,
          project_id: null,
          reminder_lead_minutes: e.reminder_lead_minutes ?? null,
        };
        return adapter.events.create(input);
      });
      const eventsFailed = eventResults.filter((r) => r.status === 'rejected').length;

      setProgress({ phase: '互动', done: 0, total: counts.interactions });
      const interactionResults = await runWithConcurrency(
        raw.interactions!,
        5,
        async (i) => {
          const input: CreateInteractionInput = {
            user_id: uid,
            occurred_at: i.occurred_at,
            channel: i.channel ?? null,
            summary: i.summary,
            contact_id: i.contact_nickname
              ? contactNicknameToId.get(i.contact_nickname) ?? null
              : null,
            action_id: null,
            event_id: null,
          };
          return adapter.interactions.create(input);
        },
      );
      const interactionsFailed = interactionResults.filter(
        (r) => r.status === 'rejected',
      ).length;

      setProgress({ phase: '待办', done: 0, total: counts.actions });
      const actionResults = await runWithConcurrency(raw.actions!, 5, async (a) => {
        const input: CreateActionInput = {
          user_id: uid,
          title: a.title,
          status: a.status ?? null,
          priority: a.priority ?? null,
          category: a.category ?? null,
          due_at: a.due_at ?? null,
          contact_id: a.contact_nickname
            ? contactNicknameToId.get(a.contact_nickname) ?? null
            : null,
          project_id: null,
        };
        return adapter.actions.create(input);
      });
      const actionsFailed = actionResults.filter((r) => r.status === 'rejected').length;

      setProgress({ phase: '提醒', done: 0, total: counts.reminders });
      const reminderResults = await runWithConcurrency(raw.reminders!, 5, async (r) => {
        const input: CreateReminderInput = {
          user_id: uid,
          contact_id: r.contact_nickname
            ? contactNicknameToId.get(r.contact_nickname) ?? null
            : null,
          event_id: null,
          trigger_at: r.trigger_at,
          kind: r.kind ?? null,
        };
        return adapter.reminders.create(input);
      });
      const remindersFailed = reminderResults.filter((r) => r.status === 'rejected').length;

      // Phase 4 — settings (key/value upsert).
      let settingsFailed = 0;
      if (raw.settings && typeof raw.settings === 'object') {
        const entries = Object.entries(raw.settings as Record<string, string>);
        setProgress({ phase: '设置', done: 0, total: entries.length });
        const settingsResults = await runWithConcurrency(entries, 5, async ([key, value]) => {
          return adapter.settings.upsert(uid, key, String(value));
        });
        settingsFailed = settingsResults.filter((r) => r.status === 'rejected').length;
      }

      setProgress(null);
      setBusy(null);
      invalidateAll();

      const failed =
        tagsFailed +
        contactsFailed +
        eventsFailed +
        interactionsFailed +
        actionsFailed +
        remindersFailed +
        settingsFailed;
      const succeeded =
        counts.tags +
        counts.contacts +
        counts.events +
        counts.interactions +
        counts.actions +
        counts.reminders +
        settingsCount;
      if (failed > 0) {
        alert(
          `导入完成: 成功 ${succeeded - failed}, 失败 ${failed}。失败可能由重名或约束冲突导致, 请查看控制台日志。`,
        );
      } else {
        alert(`导入完成: 成功 ${succeeded} 条记录。`);
      }
    } catch (err) {
      setBusy(null);
      setProgress(null);
      alert(`导入失败: ${String(err)}`);
    }
  }

  const isBusy = busy !== null;
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>
        💾 备份 / 恢复
      </h3>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '6px 0 12px', lineHeight: 1.6 }}>
        导出全部数据为 JSON 文件, 可用于备份或迁移。文件格式与旧版 Web 导出 (<code>prm-export-*.json</code>) 兼容, 可直接导入恢复。
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleExport}
          disabled={isBusy}
          style={{ opacity: isBusy ? 0.6 : 1 }}
        >
          {busy === 'export' ? '导出中…' : '导出全部数据'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => importInputRef.current?.click()}
          disabled={isBusy}
          style={{ opacity: isBusy ? 0.6 : 1 }}
        >
          {busy === 'import' ? '导入中…' : '导入备份'}
        </button>
        {progress && total > 0 && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {progress.phase} {done}/{total}
          </span>
        )}
      </div>

      <a ref={exportInputRef} style={{ display: 'none' }} aria-hidden="true" />
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
