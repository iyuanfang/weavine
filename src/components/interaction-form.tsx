'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logInteractionAction } from '@/app/contacts/[id]/actions';
import { DateTimeInput } from './datetime-input';

export function InteractionForm({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [occurredAt, setOccurredAt] = useState<Date | null>(new Date());

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    try {
      await logInteractionAction(contactId, formData);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      action={handleSubmit}
      className="card mt-3 space-y-2"
    >
      <div className="grid grid-cols-2 gap-2">
        <DateTimeInput
          name="occurredAt"
          required
          value={occurredAt}
          onChange={setOccurredAt}
          size="sm"
          showHelperText={false}
          placeholder="现在 / 刚才 / 14:30"
        />
        <select
          name="channel"
          defaultValue="微信"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option>微信</option>
          <option>电话</option>
          <option>线下</option>
          <option>邮件</option>
          <option>其他</option>
        </select>
      </div>
      <div className="flex gap-2">
        <input
          name="summary"
          required
          placeholder="本次互动概要"
          className="input-base flex-1"
        />
        <button disabled={saving} className="btn-primary">
          {saving ? '互动中…' : '互动'}
        </button>
      </div>
    </form>
  );
}