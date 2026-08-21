import { healthBucket, healthColor, healthScore } from '../lib/keepInTouch';

export function HealthDot({
  importance,
  lastInteractionIso,
  size = 8,
}: {
  importance: string;
  lastInteractionIso: string | null | undefined;
  size?: number;
}) {
  const score = healthScore(importance, lastInteractionIso);
  const bucket = healthBucket(score);
  const color = healthColor(bucket);
  const label =
    score === null
      ? '尚未互动'
      : bucket === 'fresh'
        ? `关系活跃 (${(score * 100).toFixed(0)})`
        : bucket === 'warm'
          ? `关系转凉 (${(score * 100).toFixed(0)})`
          : bucket === 'cool'
            ? `快断联了 (${(score * 100).toFixed(0)})`
            : `已断联 (${(score * 100).toFixed(0)})`;
  return (
    <span
      title={label}
      aria-label={label}
      data-testid="health-dot"
      data-bucket={bucket}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}