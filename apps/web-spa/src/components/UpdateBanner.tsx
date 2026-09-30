import { useEffect, useState } from 'react';

import { fetchLatestAndroidVersion, fetchLatestDesktopUpdate } from '../lib/app-updater';

const CURRENT_VERSION_KEY = 'weavine.skipped_version';

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * New-version banner: shown when the server advertises a version newer than
 * the running app. Desktop users are handled by the Tauri updater (silent);
 * this banner targets web and Android users, who must download manually.
 * Dismissal is stored per-version — a newer release re-shows the banner.
 */
export function UpdateBanner() {
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  useEffect(() => {
    // Desktop: the Tauri updater handles updates in Settings — no banner.
    if (isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        const version = isAndroid
          ? await fetchLatestAndroidVersion()
          : (await fetchLatestDesktopUpdate())?.version ?? null;
        if (!version || cancelled) return;
        const current = import.meta.env.APP_VERSION;
        if (compareVersions(version, current) > 0) {
          setLatest(version);
          setDismissed(localStorage.getItem(CURRENT_VERSION_KEY) === version);
        }
      } catch {
        // Update check is best-effort; ignore offline/404.
      }
    })();
    return () => { cancelled = true; };
  }, [isTauri, isAndroid]);

  if (!latest || dismissed) return null;
  const apkUrl = `https://www.weavine.com/downloads/v${latest}/Weavine_arm64-release_cloud.apk`;
  const targetUrl = isAndroid ? apkUrl : 'https://www.weavine.com';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        background: 'var(--accent-soft, #d1fae5)',
        borderBottom: '1px solid var(--accent, #059669)',
        fontSize: 'var(--text-sm)',
      }}
      data-testid="update-banner"
    >
      <span style={{ flex: 1 }}>
        🎉 新版本 v{latest} 已发布{isAndroid ? '，点击右侧下载安装' : '，刷新页面即可更新'}
      </span>
      <a
        href={targetUrl}
        style={{ color: 'var(--accent, #059669)', fontWeight: 600, textDecoration: 'none' }}
        onClick={() => localStorage.setItem(CURRENT_VERSION_KEY, latest)}
      >
        {isAndroid ? '下载 APK' : '了解更多'}
      </a>
      <button
        type="button"
        aria-label="关闭"
        onClick={() => {
          localStorage.setItem(CURRENT_VERSION_KEY, latest);
          setDismissed(true);
        }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}
      >
        ×
      </button>
    </div>
  );
}
