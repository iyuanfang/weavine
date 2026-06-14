'use client';

import { useFormStatus } from 'react-dom';
import { logInteractionAction } from '@/app/contacts/[id]/actions';

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="btn-primary text-sm disabled:opacity-50"
    >
      {pending ? '记录中…' : '记录'}
    </button>
  );
}

export function InteractionForm({ contactId }: { contactId: string }) {
  const today = new Date().toISOString().slice(0, 16);

  return (
    <form
      action={logInteractionAction.bind(null, contactId)}
      className="mt-3 grid grid-cols-3 gap-2 rounded border p-3 text-sm"
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
        <SubmitBtn />
      </div>
    </form>
  );
}
