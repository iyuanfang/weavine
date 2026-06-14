import { relationshipStrength } from '@/lib/relationship';

export function RelationshipBadge({
  lastContactedAt,
  thresholds,
  showDot = false,
}: {
  lastContactedAt: Date | string | null;
  thresholds?: number[];
  showDot?: boolean;
}) {
  const info = relationshipStrength(lastContactedAt, new Date(), thresholds);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${info.badgeColor}`}
    >
      {showDot && <span className={`h-1.5 w-1.5 rounded-full ${info.dotColor}`} />}
      {info.label}
    </span>
  );
}
