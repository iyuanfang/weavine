import { useEffect } from 'react';

import { isTauri } from './adapter/tauri';

// The service worker exists to support the browser-PWA path (offline
// cache + install prompt). Inside the Tauri desktop webview it adds
// no value — Tauri serves assets through its own asset protocol — but
// a cached SW can and does serve stale HTML for known routes after an
// upgrade, because WebView2 doesn't always trigger a fresh SW install
// on its own. Result: blank window with a perfectly good new bundle.
// Skip registration when running under Tauri.

export function RegisterSW() {
  useEffect(() => {
    if (isTauri) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // silently ignore — SW failure is non-fatal
      });
    }
  }, []);

  return null;
}
