import { ContactService } from '@/server/services/contact';
import { NewActionForm } from '@/components/new-action-form';
import { getCurrentUser } from '@/lib/auth/session';

export default async function NewAction({
  searchParams,
}: {
  searchParams: { contactId?: string };
}) {
  const { id: ownerId } = await getCurrentUser();
  const contacts = await ContactService.listLight(ownerId);
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">新建待办</h1>
      <p className="mt-1 text-sm text-gray-500">
        输入"明天下午3点" "下周三" "本周" 都能自动解析成截止时间。
      </p>
      <NewActionForm contacts={contacts} defaultContactId={searchParams.contactId} />
    </main>
  );
}
