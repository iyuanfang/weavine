import { getCurrentUser } from '@/lib/auth/session';
import { ReminderService, type ReminderItem } from '@/server/services/reminder';
import { ReminderRow } from '@/components/reminder-row';

export const metadata = { title: '提醒中心' };

function Section({
  title,
  items,
  emptyLabel,
  accent,
}: {
  title: string;
  items: ReminderItem[];
  emptyLabel: string;
  accent?: 'red' | 'blue' | 'yellow';
}) {
  const badgeColor = accent === 'red' ? 'bg-red-100 text-red-600' : accent === 'blue' ? 'bg-blue-100 text-blue-600' : accent === 'yellow' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600';

  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm font-medium text-gray-500 mb-3">
        {title}
        {items.length > 0 && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${badgeColor}`}>
            {items.length}
          </span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <ReminderRow key={r.key} reminder={r} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function RemindersPage() {
  const { id: ownerId } = await getCurrentUser();
  const items = await ReminderService.listGrouped(ownerId);

  const overdueActions = items.filter((r) => r.kind === 'action_overdue');
  const upcomingEvents = items.filter((r) => r.kind === 'event_upcoming');
  const contactReminders = items.filter((r) => r.kind === 'contact_reminder');

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <h1 className="text-xl font-semibold mb-6">提醒中心</h1>

      <Section title="过期待办" items={overdueActions} emptyLabel="没有过期待办" accent="red" />
      <Section title="近期日程" items={upcomingEvents} emptyLabel="没有近期日程" accent="blue" />
      <Section title="互动提醒" items={contactReminders} emptyLabel="暂无互动提醒" accent="yellow" />
    </main>
  );
}
