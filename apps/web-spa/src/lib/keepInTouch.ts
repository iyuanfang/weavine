//! Keep-in-touch cadence logic shared by the picker UI and the list badge.
//!
//! Defaults mirror `src-tauri/src/business/keep_in_touch.rs::cadence_days`.

const DEFAULTS: Record<string, number> = {
  high: 30,
  medium: 90,
  low: 180,
};

export function effectiveCadenceDays(
  importance: string,
  overrideDays: number | null | undefined,
): number {
  if (typeof overrideDays === 'number' && overrideDays > 0) return overrideDays;
  return DEFAULTS[importance] ?? 180;
}

export function cadenceLabel(days: number): string {
  if (days < 30) return `每 ${days} 天`;
  if (days < 365) return `每 ${Math.round(days / 30)} 个月`;
  return `每 ${(days / 365).toFixed(1)} 年`;
}

/**
 * Returns how many days until this contact should be re-engaged. Negative
 * means the cadence is overdue (the user has gone cold). `null` when the
 * contact has never been interacted with.
 */
export function daysUntilCold(
  lastInteractionIso: string | null | undefined,
  importance: string,
  overrideDays: number | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!lastInteractionIso) return null;
  const last = new Date(lastInteractionIso);
  if (isNaN(last.getTime())) return null;
  const cadenceMs = effectiveCadenceDays(importance, overrideDays) * 86_400_000;
  const due = last.getTime() + cadenceMs;
  return Math.floor((due - now.getTime()) / 86_400_000);
}