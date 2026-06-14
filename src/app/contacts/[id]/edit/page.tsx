import { notFound } from 'next/navigation';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { ContactForm } from '@/components/contact-form';

export default async function EditContact({
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

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">编辑联系人</h1>
      <ContactForm
        tags={tags}
        mode="edit"
        initial={{
          id: c.id,
          name: c.name,
          company: c.company ?? '',
          title: c.title ?? '',
          city: c.city ?? '',
          email: c.email ?? '',
          phone: c.phone ?? '',
          wechat: c.wechat ?? '',
          birthdayMonth: c.birthdayMonth ? String(c.birthdayMonth) : '',
          birthdayDay: c.birthdayDay ? String(c.birthdayDay) : '',
          notes: c.notes ?? '',
          tagIds: c.tags.map((ct) => ct.tag.id),
        }}
      />
    </main>
  );
}
