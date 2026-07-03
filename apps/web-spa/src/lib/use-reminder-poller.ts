import { useEffect } from "react";

import { useAdapter } from "./adapter";
import { useOwnerId } from "./auth";
import { ensurePermission, fire } from "./notifications";

const POLL_INTERVAL_MS = 30_000;

export function useReminderPoller() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  useEffect(() => {
    if (!ownerId) return;
    let timerId: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      let reminders;
      try {
        reminders = await adapter.reminders.list({
          owner_id: ownerId ?? "local-default",
          include_dismissed: false,
        });
      } catch (e) {
        console.warn("reminder poller: list failed", e);
        return;
      }
      const now = Date.now();
      for (const r of reminders) {
        if (r.dispatched || r.dismissed) continue;
        if (new Date(r.trigger_at).getTime() > now) continue;
        const ok = fire("Weavine · 提醒", humanize(r));
        if (ok) {
          try {
            await adapter.reminders.update({ id: r.id, dispatched: true });
          } catch (e) {
            console.warn("reminder poller: mark dispatched failed", e);
          }
        }
      }
    }

    function humanize(r: { kind: string; trigger_at: string; event_id?: string | null }): string {
      const when = new Date(r.trigger_at).toLocaleString();
      if (r.kind === "event") return `日程提醒 · ${when}`;
      if (r.kind === "action") return `待办提醒 · ${when}`;
      return `提醒 · ${when}`;
    }

    let cancelled = false;
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
  }, [adapter, ownerId]);
}
