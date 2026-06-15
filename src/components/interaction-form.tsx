'use client';

import { useRouter } from 'next/navigation';
import { useTransition, useState } from 'react';
import { logInteractionAction } from '@/app/contacts/[id]/actions';

export function InteractionForm({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 16);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    await logInteractionAction(contactId, formData);
    startTransition(() => router.refresh());
    setSaving(false);
  }

  return (
    <form
      action={handleSubmit}
      className="card mt-3 grid grid-cols-3 gap-2"
    >
      <input
        name="occurredAt"
        type="datetime-local"
        required
        defaultValue={today}
        className="input-base"
      />
      <input
        name="channel"
        placeholder="渠道（微信/电话/线下/…）"
        className="input-base"
      />
      <div className="col-span-3 flex gap-2">
        <input
          name="summary"
          required
          placeholder="本次互动概要"
          className="input-base flex-1"
        />
        <button disabled={saving} className="btn-primary">
          {saving ? '记录中…' : '记录'}
        </button>
      </div>
    </form>
  );
}
