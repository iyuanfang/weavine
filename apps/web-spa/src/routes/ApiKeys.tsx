import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import type { ApiKeySummary, ApiKeyRevealed } from '../lib/adapter/types';

export function ApiKeysPage() {
  const adapter = useAdapter();
  const userId = useUserId();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['api-keys', userId],
    queryFn: () => adapter.apiKeys.list(userId!),
    enabled: !!userId,
  });

  const create = useMutation({
    mutationFn: (n: string) =>
      adapter.apiKeys.create(userId!, { name: n }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['api-keys', userId] });
      copyToClipboard(row.key, row.id);
      setName('');
      setError(null);
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => adapter.apiKeys.revoke(userId!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', userId] }),
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  async function copyExisting(id: string) {
    setError(null);
    try {
      const r: ApiKeyRevealed = await adapter.apiKeys.reveal(userId!, id);
      await copyToClipboard(r.key, id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyToClipboard(text: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, 2000);
    } catch {
      setError('浏览器拒绝写入剪贴板 — 请手动选择复制');
    }
  }

  if (!userId) {
    return <div style={{ padding: 24 }}>请先登录</div>;
  }

  const rows: ApiKeySummary[] = list.data ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <PageHeader title="API 密钥" />

      <p style={{ color: '#666', marginBottom: 24 }}>
        用于外部客户端（如 weavine-mcp）以 <code>X-API-Key</code> 方式调用 API。每个密钥可以随时点击「复制」显示明文，无需重新签发。
      </p>

      <section style={card}>
        <h3 style={{ marginTop: 0 }}>创建新密钥</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="名称（如：本地 Codex）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={input}
            disabled={create.isPending}
          />
          <button
            type="button"
            onClick={() => create.mutate(name.trim())}
            disabled={create.isPending || name.trim().length === 0}
            style={primaryBtn}
          >
            {create.isPending ? '创建中…' : '创建'}
          </button>
        </div>
        {error && <div style={errorBox}>{error}</div>}
      </section>

      <section style={{ ...card, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>现有密钥</h3>
        {list.isLoading && <div style={{ color: '#666' }}>加载中…</div>}
        {list.isError && (
          <div style={errorBox}>加载失败：{String(list.error)}</div>
        )}
        {!list.isLoading && rows.length === 0 && (
          <div style={{ color: '#666' }}>还没有密钥。创建第一个？</div>
        )}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #ddd', textAlign: 'left' }}>
                <th style={th}>名称</th>
                <th style={th}>前缀</th>
                <th style={th}>末四位</th>
                <th style={th}>创建时间</th>
                <th style={th}>最后使用</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{r.name}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.prefix}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.last4}</td>
                  <td style={td}>{r.created_at}</td>
                  <td style={td}>{r.last_used_at ?? '—'}</td>
                  <td style={{ ...td, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => copyExisting(r.id)}
                      style={secondaryBtn}
                    >
                      {copiedId === r.id ? '已复制 ✓' : '复制'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`确认撤销密钥 "${r.name}"？撤销后所有使用此密钥的客户端将立即无法访问。`)) {
                          revoke.mutate(r.id);
                        }
                      }}
                      style={dangerBtn}
                      disabled={revoke.isPending}
                    >
                      撤销
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const card: React.CSSProperties = {
  padding: 16,
  borderRadius: 8,
  background: '#fff',
  border: '1px solid #e5e5e5',
};
const input: React.CSSProperties = {
  flex: 1,
  padding: '8px 10px',
  border: '1px solid #ccc',
  borderRadius: 6,
  fontSize: 14,
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderRadius: 6,
  background: '#1677ff',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid #ccc',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
};
const dangerBtn: React.CSSProperties = {
  padding: '6px 12px',
  border: 'none',
  borderRadius: 6,
  background: '#fff2f0',
  color: '#cf1322',
  borderColor: '#ffa39e',
  cursor: 'pointer',
  fontSize: 13,
};
const th: React.CSSProperties = {
  padding: '8px 6px',
  fontWeight: 600,
  fontSize: 13,
};
const td: React.CSSProperties = {
  padding: '10px 6px',
  fontSize: 14,
};
const errorBox: React.CSSProperties = {
  marginTop: 8,
  padding: '8px 12px',
  background: '#fff2f0',
  border: '1px solid #ffa39e',
  borderRadius: 4,
  color: '#cf1322',
  fontSize: 13,
};
