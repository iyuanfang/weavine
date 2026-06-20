import { notFound } from 'next/navigation';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { ContactForm } from '@/components/contact-form';
import { getCurrentUser } from '@/lib/auth/session';

export default async function EditContact({
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
  const tags = await TagService.list(ownerId);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">编辑联系人</h1>
      <ContactForm
        tags={tags}
        mode="edit"
        initial={{
          id: c.id,
          nickname: c.nickname ?? '',
          name: c.name ?? '',
          company: c.company ?? '',
          title: c.title ?? '',
          city: c.city ?? '',
          email: c.email ?? '',
          phone: c.phone ?? '',
          wechat: c.wechat ?? '',
          notes: c.notes ?? '',
          tagIds: c.tags.map((ct) => ct.tag.id),
          importance: c.importance,
          reminderEnabled: c.reminderEnabled,
          reminderIntervalDays: c.reminderIntervalDays ?? undefined,
        }}
      />
    </main>
  );
}
