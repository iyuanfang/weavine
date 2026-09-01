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
      let unlisten: (() => void) | null = null;
      let cancelled = false;
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
          unlisten = await listen<Reminder>("weavine:reminder-fired", (event) => {
            const r = event.payload;
            if (!r) return;
            window.dispatchEvent(new CustomEvent("weavine:reminder", { detail: r }));
          });
          const unlistenSync = await listen<Array<{ kind: string; row_id: string; reason: string }>>(
            "weavine:sync-conflicts",
            (event) => {
              const payload = event.payload;
              if (!payload || payload.length === 0) return;
              window.dispatchEvent(new CustomEvent("weavine:sync-conflicts", { detail: payload }));
            },
          );
          return () => {
            cancelled = true;
            if (unlisten) unlisten();
            unlistenSync();
          };
        } catch (e) {
          console.warn("reminder poller: failed to subscribe to tauri event", e);
        }
      })();
      return () => {
        cancelled = true;
        if (unlisten) unlisten();
      };
    }

    let timerId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function tick() {
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
      const now = Date.now();
      const due: Reminder[] = [];
      for (const r of reminders) {
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