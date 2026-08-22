//! Keep-in-touch cadence logic.
//!
//! Each contact has a `cadence_days` (days between expected touches):
//!   - If the user set an override (`Contact.keep_in_touch_cadence_days`),
//!     that wins.
//!   - Otherwise it falls back to the importance-tier default:
//!     high = 30d, medium = 90d, low = null (no reminder — opt out by default).
//!
//! When `last_interaction_at + cadence_days` arrives, an OS notification
//! fires ("该联系了") and the contact is flagged as overdue everywhere it
//! is shown.

const DEFAULTS: Record<string, number | null> = {
  high: 30,
  medium: 90,
  low: null,
};

/**
 * Effective cadence in days. `null` means "no reminder" (low importance
 * without an override, or unknown importance).
 */
export function effectiveCadenceDays(
  importance: string,
  overrideDays: number | null | undefined,
): number | null {
  if (typeof overrideDays === 'number' && overrideDays > 0) return overrideDays;
  return DEFAULTS[importance] ?? null;
}

export function cadenceLabel(days: number): string {
  if (days < 30) return `每 ${days} 天`;
  if (days < 365) return `每 ${Math.round(days / 30)} 个月`;
  return `每 ${(days / 365).toFixed(1)} 年`;
}

export interface NextReminder {
  /** Days until the next reminder fires. Negative = overdue by N days. */
  days: number | null;
  /** Whether the cadence is set (i.e. the contact has a reminder at all). */
  hasCadence: boolean;
  /** Whether last_interaction is recorded (only meaningful when hasCadence). */
  hasInteraction: boolean;
}

/**
 * Days until the next reminder fires for this contact.
 * `null` means no cadence is configured (low importance without override,
 * or unknown importance).
 *
 * If there is no `last_interaction_at` yet, returns `null` — the contact
 * has no reminder to count down to.
 */
export function nextReminderIn(
  lastInteractionIso: string | null | undefined,
  importance: string,
  overrideDays: number | null | undefined,
  now: Date = new Date(),
): NextReminder {
  const cadence = effectiveCadenceDays(importance, overrideDays);
  if (cadence === null) return { days: null, hasCadence: false, hasInteraction: false };
  if (!lastInteractionIso) {
    return { days: null, hasCadence: true, hasInteraction: false };
  }
  const last = new Date(lastInteractionIso);
  if (isNaN(last.getTime())) {
    return { days: null, hasCadence: true, hasInteraction: false };
  }
  const dueMs = last.getTime() + cadence * 86_400_000;
  const days = Math.floor((dueMs - now.getTime()) / 86_400_000);
  return { days, hasCadence: true, hasInteraction: true };
}