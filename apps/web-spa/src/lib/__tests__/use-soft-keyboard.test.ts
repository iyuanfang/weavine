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

/**
 * `readInset` turns the visual-viewport delta into `--kb-inset`, and the shell
 * gives up exactly that much height — so a false positive is not cosmetic, it
 * shrinks the whole app.
 */
async function insetOf(vv: Record<string, unknown>, innerHeight: number): Promise<number> {
  vi.resetModules();
  Object.defineProperty(globalThis, 'window', {
    value: { innerHeight, visualViewport: vv },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ANDROID_UA },
    configurable: true,
    writable: true,
  });
  const mod = await import('../use-soft-keyboard');
  return mod.readInset();
}

describe('readInset', () => {
  afterEach(() => {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).navigator;
  });

  it('reports the keyboard when only the visual viewport shrank', async () => {
    expect(await insetOf({ height: 512, offsetTop: 0, scale: 1 }, 812)).toBe(300);
  });

  it('ignores a pinch-zoom, which shrinks the visual viewport with no keyboard', async () => {
    // A 375x812 phone zoomed to 1.43x: vv.height drops to 568 on its own. Before
    // the scale guard this reported --kb-inset: 244px and shrank the shell.
    expect(await insetOf({ height: 568, offsetTop: 0, scale: 1.43 }, 812)).toBe(0);
  });

  it('stays inert when the engine reports no scale at all', async () => {
    // Older/partial implementations: fall through to the arithmetic, which is
    // the pre-guard behaviour.
    expect(await insetOf({ height: 512, offsetTop: 0 }, 812)).toBe(300);
  });

  it('ignores a sub-threshold shrink (address bar, rounding)', async () => {
    expect(await insetOf({ height: 780, offsetTop: 0, scale: 1 }, 812)).toBe(0);
  });

  it('does not count a visual viewport that was merely panned', async () => {
    expect(await insetOf({ height: 512, offsetTop: 300, scale: 1 }, 812)).toBe(0);
  });
});
