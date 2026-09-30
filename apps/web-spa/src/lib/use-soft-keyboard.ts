import { useEffect } from 'react';

import { isTauri } from './adapter/tauri';
import { osStr } from './install-id';

/**
 * Soft-keyboard height → `--kb-inset`.
 *
 * The app shell is `height: 100dvh`, so the bottom input bar only lifts when
 * the *layout* viewport gets shorter. Chromium's default for keyboard
 * interaction is `resizes-visual` (the window keeps its height and only the
 * visual viewport shrinks), and the Tauri Android webview reports nothing at
 * all (tauri-apps/tauri#10631, still open) — which is why the APK needed a
 * native fix (src-tauri/android-overrides/MainActivity.kt) instead of CSS.
 *
 * This hook is the web-side half:
 *   - no-op where the engine already resized the layout viewport (then
 *     `innerHeight === visualViewport.height` and the delta is 0, so the bar
 *     is never lifted twice);
 *   - lifts the shell where only the visual viewport shrank — iOS webviews,
 *     Chrome, standalone PWAs;
 *   - **switched off entirely inside the Android shell**, where the native
 *     inset bridge owns the lift (see `nativeBridgeOwnsKeyboard`).
 *
 * Consumers read it as `calc(… - var(--kb-inset, 0px))`; the property is
 * removed (not set to 0) when the keyboard is closed so the fallback applies.
 */
const MIN_INSET_PX = 80;

/**
 * True inside the Android shell, where the native WindowInsets bridge
 * (src-tauri/android-overrides/MainActivity.kt) already shortens the webview.
 *
 * This hook must then stay inert rather than relying on the engine not
 * reporting the keyboard: if some future Android WebView starts reporting it
 * through `visualViewport` — the thing tauri-apps/tauri#10631 says it does not
 * do today — the native padding is already in place and this hook would add a
 * second lift of the same height, parking the input bar a keyboard's height
 * above the keyboard. Deterministic beats hopeful.
 *
 * Uses the app's own two platform signals rather than new ones: `isTauri` is
 * how every other module decides it is not in a browser, and `osStr()` is the
 * shared UA helper. `isTauri` is evaluated at module load, which is safe — the
 * shell injects `__TAURI_INTERNALS__` at document-start, before the bundle
 * runs (the whole adapter layer depends on that).
 *
 * Exported for `__tests__/use-soft-keyboard.test.ts`; it is not part of any
 * public surface.
 */
export function nativeBridgeOwnsKeyboard(): boolean {
  return isTauri && osStr() === 'android';
}

function readInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  // `offsetTop` covers pinch-zoom/pan: the visual viewport can be scrolled
  // inside the layout viewport without the keyboard being involved.
  const inset = window.innerHeight - vv.height - vv.offsetTop;
  return inset > MIN_INSET_PX ? Math.round(inset) : 0;
}

export function useSoftKeyboard(): void {
  useEffect(() => {
    const root = document.documentElement;
    if (nativeBridgeOwnsKeyboard()) {
      // Belt and braces: if an earlier mount (or a re-render across a WebView
      // reload) left the property behind, clear it.
      root.style.removeProperty('--kb-inset');
      root.removeAttribute('data-kb');
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const inset = readInset();
      if (inset > 0) {
        root.style.setProperty('--kb-inset', `${inset}px`);
        root.setAttribute('data-kb', 'open');
      } else {
        root.style.removeProperty('--kb-inset');
        root.removeAttribute('data-kb');
      }
    };
    // The keyboard fires a burst of resizes while it animates in; coalesce to
    // one write per frame so the shell does not thrash mid-animation.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty('--kb-inset');
      root.removeAttribute('data-kb');
    };
  }, []);
}
