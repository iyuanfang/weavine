export type Strength = 'fresh' | 'warm' | 'stale' | 'cold' | 'unknown';

export type RelationshipInfo = {
  days: number | null;
  level: Strength;
  label: string;
  badgeColor: string;
  dotColor: string;
};

const DEFAULT_THRESHOLDS = [30, 90, 180];

export function relationshipStrength(
  lastContactedAt: Date | string | null,
  now: Date = new Date(),
  thresholds: number[] = DEFAULT_THRESHOLDS,
): RelationshipInfo {
  if (!lastContactedAt) {
    return {
      days: null,
      level: 'unknown',
      label: '从未联系',
      badgeColor: 'bg-gray-100 text-gray-500',
      dotColor: 'bg-gray-300',
    };
  }
  const last = new Date(lastContactedAt);
  const days = Math.floor((now.getTime() - last.getTime()) / 86400_000);
  const [tFresh = 30, tWarm = 90, tStale = 180] = thresholds;
  if (days <= tFresh) {
    return {
      days,
      level: 'fresh',
      label: days === 0 ? '今天联系' : `${days} 天前`,
      badgeColor: 'bg-green-100 text-green-700',
      dotColor: 'bg-green-500',
    };
  }
  if (days <= tWarm) {
    return {
      days,
      level: 'warm',
      label: `${days} 天前`,
      badgeColor: 'bg-yellow-100 text-yellow-700',
      dotColor: 'bg-yellow-500',
    };
  }
  if (days <= tStale) {
    return {
      days,
      level: 'stale',
      label: `${days} 天前`,
      badgeColor: 'bg-orange-100 text-orange-700',
      dotColor: 'bg-orange-500',
    };
  }
  return {
    days,
    level: 'cold',
    label: `${days} 天前`,
    badgeColor: 'bg-red-100 text-red-700',
    dotColor: 'bg-red-500',
  };
}
