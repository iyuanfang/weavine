import { notFound } from 'next/navigation';
import { NeedService } from '@/server/services/need';
import { NeedForm } from '@/components/need-form';
import { updateNeed } from '@/app/needs/actions';

export default async function EditNeed({
  params,
}: {
  params: { id: string };
}) {
  let n;
  try {
    n = await NeedService.get(params.id);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">编辑：{n.title}</h1>
      <NeedForm
        action={updateNeed.bind(null, n.id)}
        contacts={[]}
        initial={n}
      />
    </main>
  );
}
