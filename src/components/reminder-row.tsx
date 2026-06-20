import Link from 'next/link';
import type { ReminderItem } from '@/server/services/reminder';

const KIND_LABEL: Record<string, string> = {
  action_overdue: '待办过期',
  event_upcoming: '即将开始',
  contact_reminder: '定期联系',
};

const KIND_COLOR: Record<string, string> = {
  action_overdue: 'text-red-600 bg-red-50',
  event_upcoming: 'text-blue-600 bg-blue-50',
  contact_reminder: 'text-amber-600 bg-amber-50',
};

export function ReminderRow({ reminder }: { reminder: ReminderItem }) {
  const kindLabel = KIND_LABEL[reminder.kind] ?? reminder.kind;
  const kindColor = KIND_COLOR[reminder.kind] ?? 'text-gray-600 bg-gray-50';

  const inner = (
    <div className="flex items-center gap-3 min-w-0">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${kindColor}`}>
        {kindLabel}
      </span>
      <div className="min-w-0">
        <span className="text-sm font-medium">{reminder.title}</span>
        <p className="text-xs text-gray-500">{reminder.description}</p>
      </div>
    </div>
  );

  return (
    <div className="flex items-center justify-between rounded border border-gray-200 bg-white px-4 py-3">
      {reminder.href ? (
        <Link href={reminder.href} className="flex-1 hover:underline">{inner}</Link>
      ) : (
        <div className="flex-1">{inner}</div>
      )}
    </div>
  );
}