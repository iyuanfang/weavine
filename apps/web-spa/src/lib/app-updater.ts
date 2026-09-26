// Desktop auto-update (Tauri updater plugin) + shared update metadata.
// Mobile and web use latest-android.json / the same version field to show
// the "new version available" banner; desktop uses the Tauri updater.

import { isTauri } from './adapter';

export const UPDATE_ENDPOINTS_BASE = 'https://www.weavine.com/downloads';

export interface UpdateInfo {
  version: string;
  notes?: string;
  /** Platform-specific payload from latest.json platforms map. */
  platformData?: { signature: string; url: string };
}

export async function fetchLatestDesktopUpdate(): Promise<UpdateInfo | null> {
  const resp = await fetch(`${UPDATE_ENDPOINTS_BASE}/latest.json`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`latest.json ${resp.status}`);
  const data = await resp.json();
  // Tauri updater endpoints format: { version, notes, platforms: { <target>: {...} } }
  return { version: data.version, notes: data.notes };
}

export async function fetchLatestAndroidVersion(): Promise<string | null> {
  const resp = await fetch(`${UPDATE_ENDPOINTS_BASE}/latest-android.json`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`latest-android.json ${resp.status}`);
  const data = await resp.json();
  return data.version ?? null;
}

/**
 * Desktop-only: check the update endpoint, download and install the update,
 * then relaunch. Throws on any failure — callers surface the message.
 * On web/mobile this rejects immediately.
 */
export async function checkAndInstallDesktopUpdate(): Promise<
  { status: 'up-to-date' } | { status: 'installed' }
> {
  if (!isTauri) throw new Error('仅桌面版支持自动更新');
  const { check } = await import('@tauri-apps/plugin-updater');
  const { relaunch } = await import('@tauri-apps/plugin-process');
  const update = await check();
  if (!update) return { status: 'up-to-date' };
  let downloaded = 0;
  let contentLength = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') contentLength = event.data.contentLength ?? 0;
    if (event.event === 'Progress') downloaded += event.data.chunkLength;
    void downloaded; void contentLength; // progress UI can subscribe later
  });
  await relaunch();
  return { status: 'installed' };
}
