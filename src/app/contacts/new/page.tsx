import { TagService } from '@/server/services/tag';
import { ContactForm } from '@/components/contact-form';
import { getCurrentUser } from '@/lib/auth/session';

export default async function NewContact() {
  const { id: ownerId } = await getCurrentUser();
  const tags = await TagService.list(ownerId);
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">新建联系人</h1>
      <ContactForm tags={tags} mode="create" />
    </main>
  );
}
