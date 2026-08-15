// Stable per-install UUID for activation tracking. Mirrors the Tauri
// `install_id::get_or_create()` flavor — same UUID is sent as
// `X-Install-Id` on every cloud request and becomes the `device_id`
// in the server's `devices` table once the user logs in.

const STORAGE_KEY = 'weavine:install_id';
const DEVICE_KEY_STORAGE_KEY = 'weavine:device_key';

function isValid(id: string): boolean {
  if (!id || id.length > 64) return false;
  return /^[A-Za-z0-9-]+$/.test(id);
}

export function getOrCreateInstallId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && isValid(existing)) return existing;
  } catch {
    // localStorage may be blocked (private mode, etc.)
  }
  const id = cryptoUUID();
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Best-effort: still return the in-memory id for this session.
  }
  return id;
}

export function getDeviceKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
    if (existing && isValid(existing)) return existing;
  } catch {
    return '';
  }
  return '';
}

export function saveDeviceKey(key: string): void {
  if (typeof window === 'undefined') return;
  if (!isValid(key)) return;
  try {
    window.localStorage.setItem(DEVICE_KEY_STORAGE_KEY, key);
  } catch {}
}

function cryptoUUID(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export function platformStr(): string {
  if (typeof navigator === 'undefined') return 'web';
  return /Android/i.test(navigator.userAgent) ? 'android' : 'web';
}

export function osStr(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Mac OS X/i.test(ua)) return 'darwin';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

export function installHeaders(appVersion: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Install-Id': getOrCreateInstallId(),
    'X-Client-Platform': platformStr(),
    'X-Client-OS': osStr(),
    'X-App-Version': appVersion,
  };
  const dk = getDeviceKey();
  if (dk) headers['X-Device-Key'] = dk;
  return headers;
}

const SERVER_URL_KEY = 'weavine:server_url';
const DEFAULT_SERVER_URL = 'https://weavine.financialagent.cc';

export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const stored = window.localStorage.getItem(SERVER_URL_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    // localStorage may be blocked
  }
  return DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SERVER_URL_KEY, url.trim());
  } catch {
    // ignore
  }
}

const FIRED_KEY = 'weavine:activation_ping_fired';

/// Fires the first-launch ping once per install. Idempotent: backed by
/// localStorage flag. Best-effort: any failure is ignored.
export function fireFirstLaunchPing(appVersion: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(FIRED_KEY)) return;
  } catch {
    // ignore
  }
  const url = getServerUrl();
  if (!url) return;
  const endpoint = `${url.replace(/\/+$/, '')}/api/activation/ping`;
  const body = {
    install_id: getOrCreateInstallId(),
    app_version: appVersion,
    os: osStr(),
    platform: platformStr(),
  };
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  })
    .then((r) => {
      if (!r.ok) return null;
      try {
        window.localStorage.setItem(FIRED_KEY, '1');
      } catch {}
      return r.json();
    })
    .then((v) => {
      if (v && typeof v.device_key === 'string') {
        saveDeviceKey(v.device_key);
      }
    })
    .catch(() => {});
}
