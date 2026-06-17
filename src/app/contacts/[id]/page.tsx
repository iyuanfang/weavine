import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContactService } from '@/server/services/contact';
import { TimelineService } from '@/server/services/timeline';
import { deleteContactAction } from '@/app/contacts/actions';
import { ConfirmDeleteForm } from '@/components/confirm-delete';
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
  const [settings, timeline] = await Promise.all([
    readSettings(),
    TimelineService.forContact(params.id),
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
          <ConfirmDeleteForm action={deleteContactAction.bind(null, c.id)}>
            <button className="btn-danger" aria-label="删除">删除</button>
          </ConfirmDeleteForm>
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

      {/* BUTTONS — Action 和 互动 */}
      <div className="mt-6 flex gap-2">
        <Link className="btn-primary text-sm" href={`/actions/new?contactId=${c.id}`}>+ Action</Link>
        <Link className="btn-secondary text-sm" href={`/?quickLog=${c.id}`}>+ 互动</Link>
      </div>

      {/* Unified timeline */}
      <section className="mt-6">
        <h2 className="text-lg font-medium">时间线</h2>
        {timeline.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">暂无记录</p>
        ) : (
          <div className="mt-4 space-y-4">
            {timeline.map(item => (
              <div key={`${item.type}-${item.id}`} className="flex items-start gap-3">
                <span className="mt-0.5 text-lg">
                  {item.type === 'event' ? '📅' : item.type === 'action' ? '☑' : '📝'}
                </span>
                <div className="flex-1 min-w-0">
                  {item.link && item.link !== '#' ? (
                    <Link href={item.link} className="text-sm font-medium hover:underline">{item.title}</Link>
                  ) : (
                    <p className="text-sm font-medium">{item.title}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">{item.subtitle}</p>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {item.timestamp.toLocaleDateString('zh-CN')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
