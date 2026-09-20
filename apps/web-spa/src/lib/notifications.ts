// Web Notification API wrapper for the Tauri webview.
//
// On Windows the WebView2 runtime implements the W3C Notification API
// and routes through the OS toast notification system. The webview
// itself is already registered as a notification source under the
// hood, so we do not have to install an AUMID ourselves the way
// `notify-rust` would require. Returns false silently if the
// permission was denied so the polling loop can keep running.

export type NotificationPermissionState = "default" | "granted" | "denied";

export type NotificationPerm = NotificationPermissionState;

export type ReminderSound = "default" | "chime" | "bell" | "silent";

export function getPermission(): NotificationPermissionState {
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission as NotificationPermissionState;
}

export function currentPermission(): NotificationPerm {
  return getPermission();
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

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  const Ctor = (window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function tone(freqStart: number, freqEnd: number, durationMs: number, type: OscillatorType = "sine") {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, now);
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(freqEnd, now + durationMs / 1000);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.05);
}

function playSound(name: ReminderSound) {
  if (name === "silent" || name === "default") return;
  try {
    if (name === "chime") tone(880, 440, 350);
    else if (name === "bell") tone(1320, 1320, 700, "triangle");
  } catch {}
}

export function fire(
  title: string,
  body: string,
  tag?: string,
  sound: ReminderSound = "default",
): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  try {
    const opts: NotificationOptions = {
      body,
      silent: sound === "silent" || sound === "chime" || sound === "bell",
    };
    if (tag) opts.tag = tag;
    new Notification(title, opts);
    playSound(sound);
    return true;
  } catch {
    return false;
  }
}

export async function showBrowserNotification(opts: {
  title: string;
  body?: string;
  tag?: string;
  onClick?: () => void;
}): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  const perm = await ensurePermission();
  if (perm !== "granted") return false;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      silent: false,
    });
    if (opts.onClick) n.onclick = opts.onClick;
    return true;
  } catch {
    return false;
  }
}