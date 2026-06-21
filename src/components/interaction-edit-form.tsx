'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateInteractionAction } from '@/app/contacts/[id]/actions';
import { DateTimeInput } from './datetime-input';

export function InteractionEditForm({
  id,
  initial,
}: {
  id: string;
  initial: { occurredAt: Date; channel: string | null; summary: string };
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState<Date | null>(initial.occurredAt);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await updateInteractionAction(id, formData);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <form
      action={handleSubmit}
      className="card mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
    >
      <div>
        <DateTimeInput
          name="occurredAt"
          required
          value={occurredAt}
          onChange={setOccurredAt}
          size="sm"
          showHelperText={false}
        />
      </div>
      <input
        name="channel"
        placeholder="渠道（微信/电话/线下/…）"
        defaultValue={initial.channel ?? ''}
        className="input-base"
      />
      <div className="col-span-1 sm:col-span-3 flex gap-2">
        <input
          name="summary"
          required
          placeholder="本次互动概要"
          defaultValue={initial.summary}
          className="input-base flex-1"
        />
        <button disabled={saving} className="btn-primary">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      {error && <p className="col-span-3 text-sm text-red-600">{error}</p>}
    </form>
  );
}