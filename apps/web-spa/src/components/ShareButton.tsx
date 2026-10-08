import { useState } from 'react';

import { getAccessToken } from '../lib/auth/storage';

type EntityType = 'note' | 'event';

interface ShareInfo {
  token: string;
  url: string;
  viewCount: number;
  revoked: boolean;
}

interface Rsvp {
  name: string;
  response: string;
  at: string;
}

const VITE_API_BASE: string = (() => {
  if (typeof import.meta === 'undefined') return '';
  const env = (import.meta as unknown as Record<string, unknown>).env as
    | Record<string, string | undefined>
    | undefined;
  return env?.VITE_API_BASE ?? '';
})();

async function shareApi<T>(path: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(
    VITE_API_BASE.replace(/\/+$/, '') + path,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => `HTTP ${resp.status}`);
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

const RESPONSE_LABEL: Record<string, string> = { yes: '参加', maybe: '可能', no: '不去' };

/**
 * Per-item share button + dialog for note/event detail pages.
 * Self-contained on purpose: both detail pages mount this with two props and
 * the whole flow (create link, copy, refresh snapshot, revoke, view stats,
 * RSVP list) lives here.
 */
export function ShareButton({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [meta, setMeta] = useState<{ viewCount: number; rsvps: Rsvp[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadMeta = async (token: string) => {
    try {
      setMeta(await shareApi(`/api/share/${token}/meta`, 'GET'));
    } catch {
      setMeta(null);
    }
  };

  const openShare = async () => {
    setOpen(true);
    setError(null);
    if (info && !info.revoked) {
      void loadMeta(info.token);
      return;
    }
    setBusy(true);
    try {
      const created = await shareApi<ShareInfo>('/api/share', 'POST', { entity_type: entityType, entity_id: entityId });
      setInfo(created);
      void loadMeta(created.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败，请手动选择链接');
    }
  };

  const refresh = async () => {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      setInfo(await shareApi<ShareInfo>(`/api/share/${info.token}`, 'PUT'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      await shareApi(`/api/share/${info.token}`, 'DELETE');
      setInfo({ ...info, revoked: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginLeft: 8 }}
        onClick={openShare}
        disabled={busy}
      >
        分享
      </button>
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.4)', display: 'flex',
            alignItems: 'flex-end', justifyContent: 'center',
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              background: 'var(--surface, #fff)', width: '100%', maxWidth: 480,
              borderRadius: '16px 16px 0 0', padding: '20px 18px calc(20px + env(safe-area-inset-bottom, 0px))',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>🔗 分享{entityType === 'note' ? '笔记' : '日程邀请'}</div>
            {error && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            {busy && !info && <div style={{ fontSize: 14, color: 'var(--text-muted, #6b7280)' }}>创建分享链接…</div>}
            {info && (
              <>
                <div
                  style={{
                    background: 'var(--bg, #f5f6f8)', borderRadius: 8, padding: '10px 12px',
                    fontSize: 13, wordBreak: 'break-all', marginBottom: 10,
                  }}
                >
                  {info.url}
                </div>
                {info.revoked ? (
                  <div style={{ color: 'var(--text-muted, #6b7280)', fontSize: 13, marginBottom: 10 }}>
                    已撤销 — 链接失效，可重新分享生成新链接
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      <button type="button" className="btn btn-primary" onClick={copyLink}>
                        {copied ? '✓ 已复制' : '复制链接'}
                      </button>
                      {entityType === 'note' && (
                        <button type="button" className="btn btn-secondary" onClick={refresh} disabled={busy}>
                          更新内容快照
                        </button>
                      )}
                      <button type="button" className="btn btn-secondary" onClick={revoke} disabled={busy}>
                        撤销分享
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>
                      {meta ? `${meta.viewCount} 次浏览` : ''}
                      {meta && entityType === 'event' && meta.rsvps.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          {meta.rsvps.map((r, i) => (
                            <div key={i}>
                              {r.name} · {RESPONSE_LABEL[r.response] ?? r.response}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', marginTop: 8 }}>
                      对方无需安装织遇，打开链接即可阅读{entityType === 'event' ? '并回应' : ''}。
                      撤销后链接立即失效。
                    </div>
                  </>
                )}
              </>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: 14 }}
              onClick={() => setOpen(false)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}
