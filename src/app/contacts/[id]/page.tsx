import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { TimelineService } from '@/server/services/timeline';
import { deleteContactAction } from '@/app/contacts/actions';
import { ConfirmDeleteForm } from '@/components/confirm-delete';
import { RelationshipBadge } from '@/components/relationship-badge';
import { Avatar } from '@/components/avatar';
import { InteractionForm } from '@/components/interaction-form';
import { InlineTagEditor } from '@/components/inline-tag-editor';
import { readSettings } from '@/app/settings/actions';
import { getCurrentUser } from '@/lib/auth/session';

export default async function ContactDetail({
  params,
}: {
  params: { id: string };
}) {
  const { id: ownerId } = await getCurrentUser();
  let c;
  try {
    c = await ContactService.get(params.id, ownerId);
  } catch {
    notFound();
  }
  const [settings, timeline, allTags] = await Promise.all([
    readSettings(),
    TimelineService.forContact(params.id, ownerId),
    TagService.list(ownerId),
  ]);

  const lastContacted = c.lastContactedAt
    ? new Date(c.lastContactedAt).toLocaleDateString('zh-CN')
    : null;

  const importanceLabels: Record<string, string> = {
    important: '重要',
    normal: '普通',
    low: '次要',
  };
  const importanceColor: Record<string, string> = {
    important: 'text-red-600 bg-red-50',
    normal: 'text-gray-500 bg-gray-50',
    low: 'text-gray-400 bg-gray-100',
  };
  const impLabel = importanceLabels[c.importance] ?? null;
  const impColor = importanceColor[c.importance] ?? 'text-gray-500 bg-gray-50';

  const reminderLabel = c.reminderEnabled
    ? `已启用${c.reminderIntervalDays ? `（每${c.reminderIntervalDays}天）` : ''}`
    : '已关闭';

  const fields: [string, string | null | undefined][] = [
    ['昵称', c.nickname],
    ['姓名', c.name],
    ['公司', c.company],
    ['职位', c.title],
    ['城市', c.city],
    ['邮箱', c.email],
    ['电话', c.phone],
    ['微信', c.wechat],
    ['最近联系', lastContacted],
  ];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={c.nickname ?? c.name ?? '?'} size={64} src={undefined} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{c.nickname ?? c.name}</h1>
              {c.name && c.nickname && c.name !== c.nickname && (
                <p className="text-sm text-gray-500">{c.name}</p>
              )}
              <RelationshipBadge
                lastContactedAt={c.lastContactedAt}
                thresholds={settings.staleDays}
                showDot
              />
              {impLabel && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${impColor}`}>
                  {impLabel}
                </span>
              )}
              {!c.reminderEnabled && (
                <span className="text-xs text-gray-400">提醒关闭</span>
              )}
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

      <InlineTagEditor
        contactId={c.id}
        initialTags={c.tags.map((t) => ({ id: t.tag.id, name: t.tag.name }))}
        ownerTags={allTags.map((t) => ({ id: t.id, name: t.name }))}
      />

      {c.notes && (
        <section className="mt-6">
          <h2 className="font-semibold">备注</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
            {c.notes}
          </p>
        </section>
      )}

      <div className="mt-6 flex gap-2">
        <Link className="btn-primary text-sm" href={`/actions/new?contactId=${c.id}`}>+ 待办</Link>
      </div>

      <div className="mt-4">
        <InteractionForm contactId={c.id} />
      </div>

      {/* Unified timeline */}
      <section className="mt-6">
        <h2 className="text-lg font-medium">时间线</h2>
        {timeline.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">暂无互动</p>
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
