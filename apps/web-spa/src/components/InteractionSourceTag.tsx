import type { Interaction } from '../lib/adapter/types';

const LABELS: Record<NonNullable<Interaction['source']>, string> = {
  manual: '',
  event: '📅 来自日程',
  todo: '✅ 来自待办',
};

export function InteractionSourceTag({
  source,
}: {
  source: Interaction['source'];
}) {
  const label = source ? LABELS[source] : '';
  if (!label) return null;
  return (
    <span
      className="badge badge--muted"
      style={{ fontSize: 'var(--text-xs)', flexShrink: 0 }}
    >
      {label}
    </span>
  );
}