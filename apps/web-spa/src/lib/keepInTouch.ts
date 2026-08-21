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

/**
 * Exponential-decay relationship health score in [0, 1].
 *
 *   score = importance_weight × exp(-days / tier_halflife)
 *
 * - `importance_weight`: how much this relationship matters overall
 * - `tier_halflife`: days for the score to halve (high importance = fast decay)
 *
 * Returns `null` when there is no recorded interaction yet.
 */
const IMPORTANCE_WEIGHT: Record<string, number> = {
  high: 1.0,
  medium: 0.85,
  low: 0.7,
};
const TIER_HALFLIFE_DAYS: Record<string, number> = {
  high: 15,
  medium: 45,
  low: 90,
};

export function healthScore(
  importance: string,
  lastInteractionIso: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!lastInteractionIso) return null;
  const last = new Date(lastInteractionIso);
  if (isNaN(last.getTime())) return null;
  const weight = IMPORTANCE_WEIGHT[importance] ?? 0.7;
  const halflife = TIER_HALFLIFE_DAYS[importance] ?? 90;
  const days = Math.max(0, (now.getTime() - last.getTime()) / 86_400_000);
  return weight * Math.exp(-days / halflife);
}

export type HealthBucket = 'fresh' | 'warm' | 'cool' | 'cold';

export function healthBucket(score: number | null): HealthBucket {
  if (score === null) return 'cool';
  if (score >= 0.6) return 'fresh';
  if (score >= 0.3) return 'warm';
  if (score >= 0.1) return 'cool';
  return 'cold';
}

const HEALTH_COLORS: Record<HealthBucket, string> = {
  fresh: '#10b981',
  warm: '#eab308',
  cool: '#f97316',
  cold: '#ef4444',
};

export function healthColor(bucket: HealthBucket): string {
  return HEALTH_COLORS[bucket];
}