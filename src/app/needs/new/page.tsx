import { NeedForm } from '@/components/need-form';
import { createNeed } from '@/app/needs/actions';

export default function NewNeed() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">新建需求</h1>
      <NeedForm action={createNeed} contacts={[]} />
    </main>
  );
}
