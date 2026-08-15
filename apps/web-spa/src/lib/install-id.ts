// Stable per-install UUID for activation tracking. Mirrors the Tauri
// `install_id::get_or_create()` flavor — same UUID is sent as
// `X-Install-Id` on every cloud request and becomes the `device_id`
// in the server's `devices` table once the user logs in.

const STORAGE_KEY = 'weavine:install_id';

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

function cryptoUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers (no crypto.randomUUID).
  // Compatible with the same UUID v4 layout the server expects.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
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
  return {
    'X-Install-Id': getOrCreateInstallId(),
    'X-Client-Platform': platformStr(),
    'X-Client-OS': osStr(),
    'X-App-Version': appVersion,
  };
}
