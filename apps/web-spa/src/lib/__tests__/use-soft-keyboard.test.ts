import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the one behavioural decision in `useSoftKeyboard`: inside the Android
 * shell the native insets bridge
 * (src-tauri/android-overrides/MainActivity.kt) shortens the webview itself, so
 * the web-side `--kb-inset` fallback must stay off. If both ran, the input bar
 * would be lifted twice — a keyboard's height above the keyboard.
 *
 * These cases import the real module with fake globals rather than testing a
 * copy of the predicate, because the whole point is that `isTauri` is read at
 * module load.
 */
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';

async function gate(opts: { shell: boolean; ua: string }): Promise<boolean> {
  vi.resetModules();
  // defineProperty, not assignment: node 22 exposes `navigator` on globalThis as
  // a getter-only accessor.
  Object.defineProperty(globalThis, 'window', {
    value: opts.shell ? { __TAURI_INTERNALS__: {} } : {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: opts.ua },
    configurable: true,
    writable: true,
  });
  const mod = await import('../use-soft-keyboard');
  return mod.nativeBridgeOwnsKeyboard();
}

describe('nativeBridgeOwnsKeyboard', () => {
  afterEach(() => {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).navigator;
  });

  it('stays off in a plain browser, so the web fallback still lifts the shell', async () => {
    expect(await gate({ shell: false, ua: ANDROID_UA })).toBe(false);
  });

  it('stays off in a browser on Android (no shell)', async () => {
    expect(await gate({ shell: false, ua: ANDROID_UA })).toBe(false);
  });

  it('stays off in the desktop shell (no native keyboard bridge there)', async () => {
    expect(
      await gate({ shell: true, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }),
    ).toBe(false);
  });

  it('is on in the Android shell, where the native padding owns the lift', async () => {
    expect(await gate({ shell: true, ua: ANDROID_UA })).toBe(true);
  });
});
