export type Strength = 'fresh' | 'warm' | 'stale' | 'cold' | 'unknown';
export type ContactImportance = 'important' | 'normal' | 'low';

export type RelationshipInfo = {
  days: number | null;
  level: Strength;
  label: string;
  badgeColor: string;
  dotColor: string;
};

const DEFAULT_THRESHOLDS = [30, 90, 180];
const DEFAULT_MAINTENANCE_INTERVALS: Record<ContactImportance, number> = {
  important: 14,
  normal: 45,
  low: 90,
};

type MaintenanceContact = {
  reminderEnabled: boolean;
  importance: string | null;
  reminderIntervalDays: number | null;
  lastContactedAt: Date | string | null;
  createdAt: Date | string;
};

export function contactMaintenanceIntervalDays(
  importance: string | null,
  reminderIntervalDays: number | null,
): number {
  if (reminderIntervalDays && reminderIntervalDays > 0) return reminderIntervalDays;
  if (importance === 'important' || importance === 'low' || importance === 'normal') {
    return DEFAULT_MAINTENANCE_INTERVALS[importance];
  }
  return DEFAULT_MAINTENANCE_INTERVALS.normal;
}

export function contactMaintenanceReminderDue(
  contact: MaintenanceContact,
  now: Date = new Date(),
): boolean {
  if (!contact.reminderEnabled) return false;
  const base = contact.lastContactedAt ?? contact.createdAt;
  const baseDate = new Date(base);
  const days = Math.floor((now.getTime() - baseDate.getTime()) / 86400_000);
  return days >= contactMaintenanceIntervalDays(contact.importance, contact.reminderIntervalDays);
}

/**
 * 计算两个日期之间的日历日差（按天边界，非滚动24小时）
 */
function calendarDayDifference(date1: Date, date2: Date): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  // 归一化到本地日期的午夜（年/月/日）
  const d1Start = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const d2Start = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.floor((d2Start.getTime() - d1Start.getTime()) / 86400_000);
}

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
  const days = calendarDayDifference(last, now);
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
