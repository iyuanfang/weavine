import { TagService } from '@/server/services/tag';
import { ContactForm } from '@/components/contact-form';

export default async function NewContact() {
  const tags = await TagService.list();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">新建联系人</h1>
      <ContactForm tags={tags} mode="create" />
    </main>
  );
}
