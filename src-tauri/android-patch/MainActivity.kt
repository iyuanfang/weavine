package com.weavine.desktop

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.PermissionRequest
import android.webkit.WebView
import androidx.core.app.ActivityCompat

// WeavineMainActivity — replaces the auto-generated MainActivity.kt produced by
// `cargo tauri android init`. CI copies this file into
// src-tauri/gen/android/app/src/main/java/com/weavine/desktop/MainActivity.kt
// after init, so the override survives the regen.
//
// Why we need it:
//
// Tauri/Wry's stock RustWebChromeClient.onPermissionRequest always routes the
// request through `permissionLauncher.launch(permissions)` even when the
// Android system permission is already granted (e.g. after the user grants
// RECORD_AUDIO on first use). On some OEM WebViews (MIUI / EMUI / OriginOS)
// the launcher call returns asynchronously and the `permissionListener` slot
// can be clobbered, causing getUserMedia() to fail with NotAllowedError even
// though the user did grant.
//
// The fix in WeavineWebChromeClient below:
//   - subclasses RustWebChromeClient,
//   - checks `checkSelfPermission` first,
//   - if already granted, calls `request.grant(resources)` synchronously
//     without going through the launcher,
//   - otherwise delegates to the same launcher-based flow.
class WeavineMainActivity : TauriActivity() {

  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.webChromeClient = WeavineWebChromeClient(this)
  }
}

private class WeavineWebChromeClient(activity: WryActivity) : RustWebChromeClient(activity) {

  override fun onPermissionRequest(request: PermissionRequest) {
    val resources = request.resources
    val needed = mutableListOf<String>()
    val wantsAudio = resources.any {
      it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it.contains("audio", ignoreCase = true)
    }
    val wantsVideo = resources.any {
      it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it.contains("video", ignoreCase = true)
    }
    if (wantsAudio) needed += Manifest.permission.RECORD_AUDIO
    if (wantsVideo) needed += Manifest.permission.CAMERA

    if (needed.isEmpty()) {
      request.grant(resources)
      return
    }

    val alreadyGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      needed.all { ActivityCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }
    } else true

    if (alreadyGranted) {
      request.grant(resources)
      return
    }

    super.onPermissionRequest(request)
  }
}