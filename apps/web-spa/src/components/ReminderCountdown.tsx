import { cadenceLabel, nextReminderIn } from '../lib/keepInTouch';

/**
 * Renders the "next reminder in X days" countdown for a contact.
 *
 *   - days > 7  → silent (contact is fine, no UI clutter)
 *   - 0 < days ≤ 7 → green "X 天后提醒"
 *   - days ≤ 0 → red "已逾期 X 天" / "今天该联系"
 *   - no cadence (low importance without override) → silent
 *   - cadence but no interaction yet → "记一笔互动后开始计时"
 */
export function ReminderCountdown({
  lastInteractionIso,
  importance,
  overrideDays,
  size = 'sm',
}: {
  lastInteractionIso: string;
  importance: string;
  overrideDays: number | null | undefined;
  size?: 'sm' | 'md';
}) {
  const { days, hasCadence } = nextReminderIn(
    lastInteractionIso,
    importance,
    overrideDays,
  );

  if (!hasCadence) return null;
  if (days === null) {
    return (
      <span
        data-testid="reminder-countdown"
        data-state="pending"
        style={badgeStyle('#94a3b8', '#e2e8f0', size)}
      >
        记一笔互动后开始计时
      </span>
    );
  }
  if (days > 7) return null;

  if (days <= 0) {
    const overdueDays = -days;
    const text =
      overdueDays === 0
        ? '今天该联系'
        : overdueDays < 30
          ? `已逾期 ${overdueDays} 天`
          : `已逾期 ${Math.round(overdueDays / 30)} 个月`;
    return (
      <span
        data-testid="reminder-countdown"
        data-state="overdue"
        title={cadenceLabel(getEffective(importance, overrideDays))}
        style={badgeStyle('#b91c1c', '#fee2e2', size)}
      >
        ❄️ {text}
      </span>
    );
  }

  return (
    <span
      data-testid="reminder-countdown"
      data-state="upcoming"
      title={cadenceLabel(getEffective(importance, overrideDays))}
      style={badgeStyle('#15803d', '#dcfce7', size)}
    >
      {days} 天后提醒
    </span>
  );
}

function getEffective(importance: string, overrideDays: number | null | undefined): number {
  const c =
    typeof overrideDays === 'number' && overrideDays > 0
      ? overrideDays
      : importance === 'high'
        ? 30
        : importance === 'medium'
          ? 90
          : 0;
  return c;
}

function badgeStyle(color: string, bg: string, size: 'sm' | 'md'): React.CSSProperties {
  return {
    fontSize: size === 'md' ? 'var(--text-base)' : 'var(--text-xs)',
    background: bg,
    color,
    border: `1px solid ${color}40`,
    borderRadius: 999,
    padding: size === 'md' ? '2px 10px' : '1px 8px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  };
}