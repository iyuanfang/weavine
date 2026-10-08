import { useEffect } from "react";

import { useAdapter } from "./adapter";
import type { Reminder } from "./adapter/types";
import { useUserId } from "./auth";
import { ensurePermission, fire, type ReminderSound } from "./notifications";

const SOUND_SETTING_KEY = "reminder_sound";
const VALID_SOUNDS: ReadonlyArray<ReminderSound> = ["default", "chime", "bell", "silent"];

const POLL_INTERVAL_MS = 30_000;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

function isTauri(): boolean {
  return typeof window !== "undefined" && (
    typeof window.__TAURI_INTERNALS__ !== "undefined" ||
    typeof window.__TAURI__ !== "undefined"
  );
}

function humanize(r: { kind: string; trigger_at: string }): string {
  const when = new Date(r.trigger_at).toLocaleString();
  if (r.kind === "event") return `日程提醒 · ${when}`;
  if (r.kind === "action") return `待办提醒 · ${when}`;
  return `提醒 · ${when}`;
}

export function useReminderPoller() {
  const adapter = useAdapter();
  const userId = useUserId();

  useEffect(() => {
    if (!userId) return;

    if (isTauri()) {
      // Every subscription goes into `cleanups` the moment it resolves, so the
      // outer disposer can always reach it. The previous shape kept only the
      // FIRST handle in a `let unlisten` and let the async IIFE return the
      // disposer — a returned value nothing consumed — which meant:
      //   • `unlistenSync` was never called: each mount leaked a permanent
      //     `weavine:sync-conflicts` listener, and every later conflict event
      //     was handled N+1 times (React StrictMode double-mounts in dev);
      //   • if unmount landed inside `await listen(...)`, `unlisten` was still
      //     null when the disposer ran, so that subscription leaked too.
      const cleanups: Array<() => void> = [];
      let cancelled = false;
      const disposeAll = () => {
        cancelled = true;
        for (const fn of cleanups.splice(0)) fn();
      };

      (async () => {
        // Eagerly request the OS notification permission so Android 13+ shows
        // the system prompt on first launch instead of silently rejecting
        // reminders (the Rust scheduler only fails fast, no retry). On
        // Windows this is a no-op; on Android the Tauri plugin surfaces the
        // runtime permission dialog via NotificationExt::request_permission.
        try {
          await adapter.notifications.requestPermission();
        } catch (e) {
          console.warn("reminder poller: notification permission request failed", e);
        }
        if (cancelled) return;
        try {
          const { listen } = await import("@tauri-apps/api/event");
          if (cancelled) return;
          const unlistenFired = await listen<Reminder>("weavine:reminder-fired", (event) => {
            const r = event.payload;
            if (!r) return;
            window.dispatchEvent(new CustomEvent("weavine:reminder", { detail: r }));
          });
          cleanups.push(unlistenFired);
          if (cancelled) return disposeAll();
          const unlistenSync = await listen<Array<{ kind: string; row_id: string; reason: string }>>(
            "weavine:sync-conflicts",
            (event) => {
              const payload = event.payload;
              if (!payload || payload.length === 0) return;
              window.dispatchEvent(new CustomEvent("weavine:sync-conflicts", { detail: payload }));
            },
          );
          cleanups.push(unlistenSync);
          // Unmount may have happened while the second `await` was in flight;
          // `cancelled` was already flipped, so release what we just took.
          if (cancelled) disposeAll();
        } catch (e) {
          console.warn("reminder poller: failed to subscribe to tauri event", e);
        }
      })();

      return disposeAll;
    }

    let timerId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    // These two guards cover the async body, not just the bootstrap below:
    // a tick that outlived its component still called `fire(...)` (system
    // notification for a screen the user had already left), and a tick slower
    // than POLL_INTERVAL_MS overlapped the next one — the same reminder was
    // fired twice, because `dispatched` is only persisted after the round
    // trip.
    let inFlight = false;

    async function tick() {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await runTick();
      } finally {
        inFlight = false;
      }
    }

    async function runTick() {
      let sound: ReminderSound = "default";
      try {
        const all = await adapter.settings.list(userId!);
        const row = all.find((s) => s.key === SOUND_SETTING_KEY);
        if (row && VALID_SOUNDS.includes(row.value as ReminderSound)) {
          sound = row.value as ReminderSound;
        }
      } catch {}

      let reminders;
      try {
        reminders = await adapter.reminders.list({
          user_id: userId ?? "local-default",
          include_dismissed: false,
        });
      } catch (e) {
        console.warn("reminder poller: list failed", e);
        return;
      }
      if (cancelled) return;
      const now = Date.now();
      const due: Reminder[] = [];
      for (const r of reminders) {
        if (cancelled) return;
        if (r.dispatched || r.dismissed) continue;
        if (new Date(r.trigger_at).getTime() > now) continue;
        due.push(r);
        const ok = fire("Weavine · 提醒", humanize(r), undefined, sound);
        if (ok) {
          try {
            await adapter.reminders.update({ id: r.id, dispatched: true });
          } catch (e) {
            console.warn("reminder poller: mark dispatched failed", e);
          }
        }
      }
      if (cancelled) return;
      for (const r of due) {
        window.dispatchEvent(new CustomEvent("weavine:reminder", { detail: r }));
      }
    }

    (async () => {
      await ensurePermission();
      if (cancelled) return;
      tick();
      timerId = setInterval(tick, POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (timerId) clearInterval(timerId);
    };
  }, [adapter, userId]);
}