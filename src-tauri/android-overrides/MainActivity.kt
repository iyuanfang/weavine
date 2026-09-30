// Native replacement for the MainActivity that `cargo tauri android init`
// generates. `src-tauri/gen/android/` is untracked (CI regenerates it), so
// .github/workflows/release.yml copies this file over the fresh one on every
// build — edit it here, not in gen/.
//
// WHY THIS EXISTS
// The home-screen input bar stayed buried under the soft keyboard on Android.
// Two things have to line up for it to lift:
//
//   1. Somebody must actually shorten the webview. Tauri's own template calls
//      enableEdgeToEdge(), and an edge-to-edge window is *never* resized for
//      the IME — `android:windowSoftInputMode="adjustResize"` is a no-op once
//      `decorFitsSystemWindows` is false. That is why the manifest patch in CI
//      ("Pin windowSoftInputMode…") cannot lift anything by itself.
//   2. The page must be able to see it. The Android webview does not report
//      the keyboard through `visualViewport` either (tauri-apps/tauri#10631,
//      still open as of 2026), so no CSS/JS in the bundle can detect it.
//
// Padding the content view by the inset is Android's documented edge-to-edge
// replacement for adjustResize. The webview view gets shorter, `100dvh`
// follows it, and the layout that already behaves at a shorter viewport
// (verified at 375×512 via mobile-repro/keyboard-probe.mjs) takes over: the
// input bar lands directly above the keyboard.
//
// WHY `systemBars() or ime()`
// That union is the snippet Android's own docs use for a root view (see the
// Android 11 "control IME animation" sample). `getInsets()` over a union takes
// the larger inset per edge, so the bottom padding is the navigation bar when
// the keyboard is closed and the keyboard itself when it is open — content
// never hides behind either. Deliberately NOT `ime.bottom - systemBars.bottom`:
// `ime.bottom` is measured from the window's bottom edge to the keyboard's top,
// so subtracting the navigation bar would let the content run a nav-bar's
// height *into* the keyboard, i.e. bury the very input bar this is meant to
// lift.
//
// The top inset is intentionally not applied: the home screen draws its dark
// hero behind the status bar on purpose, and padding the top would replace that
// band with the window background. The page insets its own controls with
// `env(safe-area-inset-top)`, which on Android only ever reflects a display
// cutout — a known gap, tracked in the spec, not fixed here.
package __PACKAGE__

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // android.R.id.content holds the layout the webview lives in; padding it
    // is what shortens the webview. Looked up after super.onCreate() so the
    // content view exists, and the listener is installed after Tauri's own
    // setup so it wins.
    val content = findViewById<View>(android.R.id.content) ?: return
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bottom = insets
        .getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
        .bottom
      view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, bottom)
      // Hand the subtree insets WITHOUT the IME: the view has already been
      // shortened for it, so letting Chromium shrink `dvh` again would lift the
      // input bar a second time.
      WindowInsetsCompat.Builder(insets)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .build()
    }
  }
}
