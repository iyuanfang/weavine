// Native replacement for the MainActivity that `cargo tauri android init`
// generates. `src-tauri/gen/android/` is untracked (CI regenerates it), so
// .github/workflows/release.yml copies this file over the fresh one on every
// build — edit it here, not in gen/.
//
// WHY THIS EXISTS
// On Android the home screen's input bar stayed buried under the soft keyboard.
// Two things have to line up for it to lift:
//
//   1. Somebody must actually shorten the webview. Tauri's own template calls
//      enableEdgeToEdge(), and an edge-to-edge window is *never* resized for the
//      IME — `android:windowSoftInputMode="adjustResize"` is a no-op once
//      `decorFitsSystemWindows` is false. That is why the manifest patch in CI
//      ("Pin windowSoftInputMode…") cannot lift anything by itself.
//   2. The page must be able to see it. The Android webview does not report the
//      keyboard through `visualViewport` either (tauri-apps/tauri#10631, still
//      open as of 2026), so no CSS/JS in the bundle can detect the keyboard.
//
// Padding the content view is Android's documented edge-to-edge replacement for
// adjustResize: the webview view gets shorter, `100dvh` follows it, and the
// layout that already behaves at a shorter viewport (verified at 375×512 with
// mobile-repro/keyboard-probe.mjs) takes over — the input bar lands directly
// above the keyboard.
//
// EVIDENCE, NOT ASSUMPTION (checked against source)
//   - The webview really is a padding-able child: wry attaches it with
//     `activity.setContentView(webview)` (wry/src/android/main_pipe.rs, the
//     "Set content view" call) → `PhoneWindow.setContentView(View)` →
//     MATCH_PARENT child of the decor's content frame. MainActivity runs after
//     super.onCreate(), and the listener is installed last so it wins over
//     whatever AppCompat registered.
//   - The androidx APIs used here exist in the template's own version
//     (androidx.core:core-ktx:1.9.0, read straight out of the CLI template and
//     verified against that AAR's classes.jar): `Type.ime()`, `getInsets(int)`,
//     `Builder.setInsets(int, Insets)`. Only `setInsetsIgnoringVisibility`
//     throws for the IME mask ("Ignoring visibility inset not available for
//     IME") — `setInsets` does not.
//
// SCOPE: IME ONLY, AND ONLY THE IME IS STRIPPED FROM THE SUBTREE
//   - Only the IME is reserved. The navigation bar is deliberately left out: the
//     page draws its own full-bleed bottom edge and `env(safe-area-inset-bottom)`
//     is 0 on Android by design, so reserving the nav bar here would paint a
//     strip of window background under the app's dark bottom navigation. (If
//     content should ever clear the nav bar, OR in `Type.systemBars()`.)
//   - The subtree keeps every other inset. Do NOT return
//     `WindowInsetsCompat.CONSUMED`: that would also stop the display-cutout
//     insets from reaching the webview, and on Android the webview's
//     `env(safe-area-inset-*)` is derived from exactly those — the drawer,
//     search overlay and login page all rely on them.
//   - Stripping the IME is what keeps Chromium from shrinking `dvh` a second
//     time (and, on the web side, from reporting a keyboard through
//     `visualViewport` and stacking `--kb-inset` on top of this padding).
//
// The top inset is intentionally not applied either: the home screen draws its
// dark hero behind the status bar on purpose, and padding the top would replace
// that band with the window background. The page insets its own controls with
// `env(safe-area-inset-top)`, which on Android only ever reflects a display
// cutout — a known gap, tracked in the spec (the ☰ / 🔍 row can sit under the
// status bar), not fixed here.
package __PACKAGE__

import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  companion object {
    // One line per inset change, so the bridge can be verified on a device with
    // `adb logcat -s WeavineInsets` instead of guesswork.
    private const val TAG = "WeavineInsets"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content) ?: return
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      if (view.paddingBottom != ime) {
        Log.i(TAG, "ime bottom ${ime}px -> content paddingBottom (was ${view.paddingBottom}px)")
      }
      view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, ime)
      WindowInsetsCompat.Builder(insets)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .build()
    }
  }
}
