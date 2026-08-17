package com.weavine.desktop

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.CustomViewCallback
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat

// MainActivity — replaces the auto-generated MainActivity.kt produced by
// `cargo tauri android init`. CI copies this file into
// src-tauri/gen/android/app/src/main/java/com/weavine/desktop/MainActivity.kt
// after init, so the override survives the regen. The class name MUST stay
// `MainActivity` because AndroidManifest.xml's <activity android:name=
// ".MainActivity"> references it directly — renaming to e.g.
// `WeavineMainActivity` breaks the APK build with "MainActivity not found".
//
// Why we need it:
//
// Tauri/Wry's stock RustWebChromeClient.onPermissionRequest always routes
// the request through `permissionLauncher.launch(permissions)` even when
// the Android system permission is already granted (e.g. after the user
// grants RECORD_AUDIO on first use). On some OEM WebViews (MIUI / EMUI /
// OriginOS) the launcher call returns asynchronously and the
// `permissionListener` slot can be clobbered, causing getUserMedia() to
// fail with NotAllowedError even though the user did grant.
//
// The fix in WeavineWebChromeClient below:
//   - composes (not subclasses!) RustWebChromeClient,
//   - intercepts onPermissionRequest only, delegates every other
//     WebChromeClient method back to RustWebChromeClient,
//   - if RECORD_AUDIO/CAMERA is already granted at the OS level, calls
//     request.grant() synchronously without going through the launcher,
//   - otherwise delegates to RustWebChromeClient.onPermissionRequest so
//     the launcher-based flow handles first-time grants as before.
//
// We can't subclass because RustWebChromeClient marks all its overrides
// `final` (Kotlin default). Subclassing breaks the build with
// "cannot override 'final'".
class MainActivity : TauriActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.webChromeClient = WeavineWebChromeClient(webView, this)
  }
}

private class WeavineWebChromeClient(
  webView: WebView,
  private val activity: WryActivity
) : WebChromeClient() {
  private val delegate: RustWebChromeClient = RustWebChromeClient(activity)

  override fun onPermissionRequest(request: PermissionRequest) {
    val resources = request.resources
    val needed = mutableListOf<String>()
    val wantsAudio = resources.any {
      it == PermissionRequest.RESOURCE_AUDIO_CAPTURE ||
        it.contains("audio", ignoreCase = true)
    }
    val wantsVideo = resources.any {
      it == PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
        it.contains("video", ignoreCase = true)
    }
    if (wantsAudio) needed += Manifest.permission.RECORD_AUDIO
    if (wantsVideo) needed += Manifest.permission.CAMERA

    if (needed.isEmpty()) {
      request.grant(resources)
      return
    }

    val alreadyGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      needed.all {
        ActivityCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
      }
    } else true

    if (alreadyGranted) {
      request.grant(resources)
      return
    }

    delegate.onPermissionRequest(request)
  }

  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    delegate.onShowCustomView(view, callback)
  }

  override fun onHideCustomView() {
    delegate.onHideCustomView()
  }

  override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
    return delegate.onJsAlert(view, url, message, result)
  }

  override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
    return delegate.onJsConfirm(view, url, message, result)
  }

  override fun onJsPrompt(
    view: WebView,
    url: String,
    message: String,
    defaultValue: String,
    result: JsPromptResult
  ): Boolean {
    return delegate.onJsPrompt(view, url, message, defaultValue, result)
  }

  override fun onGeolocationPermissionsShowPrompt(
    origin: String,
    callback: GeolocationPermissions.Callback
  ) {
    delegate.onGeolocationPermissionsShowPrompt(origin, callback)
  }

  override fun onShowFileChooser(
    webView: WebView,
    filePathCallback: ValueCallback<Array<Uri?>?>,
    fileChooserParams: android.webkit.WebChromeClient.FileChooserParams
  ): Boolean {
    return delegate.onShowFileChooser(webView, filePathCallback, fileChooserParams)
  }

  override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
    return delegate.onConsoleMessage(consoleMessage)
  }

  override fun onReceivedTitle(view: WebView, title: String) {
    delegate.onReceivedTitle(view, title)
  }
}