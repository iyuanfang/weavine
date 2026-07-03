// Web Notification API wrapper for the Tauri webview.
//
// On Windows the WebView2 runtime implements the W3C Notification API
// and routes through the OS toast notification system. The webview
// itself is already registered as a notification source under the
// hood, so we do not have to install an AUMID ourselves the way
// `notify-rust` would require. Returns false silently if the
// permission was denied so the polling loop can keep running.

export type NotificationPermissionState = "default" | "granted" | "denied";

export function getPermission(): NotificationPermissionState {
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission as NotificationPermissionState;
}

export async function ensurePermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") {
    return Notification.permission as NotificationPermissionState;
  }
  try {
    return (await Notification.requestPermission()) as NotificationPermissionState;
  } catch {
    return "denied";
  }
}

export function fire(title: string, body: string, tag?: string): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  try {
    const opts: NotificationOptions = { body, silent: false };
    if (tag) opts.tag = tag;
    new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}
