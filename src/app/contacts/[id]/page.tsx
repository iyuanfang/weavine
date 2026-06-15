import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { EventService } from '@/server/services/event';
import { InteractionService } from '@/server/services/interaction';
import { ActionService } from '@/server/services/action';
import { deleteContactAction } from '@/app/contacts/actions';
import { InteractionForm } from '@/components/interaction-form';
import { InteractionTimeline } from '@/components/interaction-timeline';
import { RelationshipBadge } from '@/components/relationship-badge';
import { Avatar } from '@/components/avatar';
import { readSettings } from '@/app/settings/actions';
import { tagColor } from '@/lib/tag-color';

export default async function ContactDetail({
  params,
}: {
  params: { id: string };
}) {
  let c;
  try {
    c = await ContactService.get(params.id);
  } catch {
    notFound();
  }
  const tags = await TagService.list();
  const [interactions, events, settings, actions] = await Promise.all([
    InteractionService.list(params.id),
    EventService.listByContact(params.id),
    readSettings(),
    ActionService.byContact(params.id),
  ]);

  const lastContacted = c.lastContactedAt
    ? new Date(c.lastContactedAt).toLocaleDateString('zh-CN')
    : null;

  const fields: [string, string | null | undefined][] = [
    ['公司', c.company],
    ['职位', c.title],
    ['城市', c.city],
    ['邮箱', c.email],
    ['电话', c.phone],
    ['微信', c.wechat],
    [
      '生日',
      c.birthdayMonth && c.birthdayDay
        ? `${String(c.birthdayMonth).padStart(2, '0')}-${String(c.birthdayDay).padStart(2, '0')}`
        : null,
    ],
    ['最近联系', lastContacted],
  ];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={c.name} size={64} src={undefined} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{c.name}</h1>
              <RelationshipBadge
                lastContactedAt={c.lastContactedAt}
                thresholds={settings.staleDays}
                showDot
              />
            </div>
            <p className="text-sm text-gray-500">
              {[c.company, c.title].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            className="btn-secondary"
            href={`/contacts/${c.id}/edit`}
          >
            编辑
          </Link>
          <form action={deleteContactAction.bind(null, c.id)}>
            <button className="btn-danger">删除</button>
          </form>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        {fields
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-gray-500">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        {c.tags.map((t) => {
          const tc = tagColor(t.tag.name);
          return (
            <span
              key={t.tag.id}
              className="badge"
              style={{ background: tc.bg, color: tc.text }}
            >
              {t.tag.name}
            </span>
          );
        })}
      </div>

      {c.notes && (
        <section className="mt-6">
          <h2 className="font-semibold">备注</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
            {c.notes}
          </p>
        </section>
      )}

      <section className="mt-8 border-t pt-6">
        <h2 className="font-semibold">互动时间线</h2>
        <InteractionForm contactId={c.id} />
        <InteractionTimeline
          contactId={c.id}
          items={interactions.map((i) => ({
            id: i.id,
            occurredAt: i.occurredAt.toISOString(),
            channel: i.channel,
            summary: i.summary,
          }))}
        />
      </section>

      <section id="action" className="mt-8 border-t pt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">行动 ({actions.length})</h2>
          <Link className="btn-primary text-sm" href={`/actions/new?contactId=${c.id}`}>+ Action</Link>
        </div>
        {actions.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">还没有跟这个人相关的 Action</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {actions.map((a) => {
              const isForThem = a.contactId === c.id;
              const isWaiting = a.waitingOnId === c.id;
              return (
                <li key={a.id} className="card flex items-center gap-2">
                  <div className="flex-1">
                    <Link className="font-medium hover:underline" href={`/actions/${a.id}`}>
                      {a.title}
                    </Link>
                    <div className="text-xs text-gray-500">
                      <span className="text-accent">{isForThem ? '我答应他' : isWaiting ? '等他回复' : '相关'}</span>
                      {' · '}
                      {a.status}
                      {a.dueAt && ` · ${a.dueAt.toLocaleDateString('zh-CN')}`}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8 border-t pt-6">
        <h2 className="font-semibold">相关事件</h2>
        {events.length === 0 ? (
          <p className="mt-1 text-sm text-gray-500">无</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  className="text-sm text-accent hover:underline"
                  href={`/events/${e.id}`}
                >
                  {e.title} · {e.startAt.toLocaleString('zh-CN')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
