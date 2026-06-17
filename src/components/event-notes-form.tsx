'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

export function EventNotesForm({
  eventId,
  onSave,
}: {
  eventId: string;
  onSave: (fd: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary mt-4">
        写纪要
      </button>
    );
  }

  return (
    <form action={onSave} className="mt-4 space-y-2">
      <input type="hidden" name="eventId" value={eventId} />
      <label className="text-sm text-gray-600">会议纪要</label>
      <textarea
        name="notes"
        placeholder="记录了哪些内容？"
        className="input-base w-full"
        rows={4}
      />
      <div className="flex gap-2">
        <SubmitButton />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-secondary"
        >
          取消
        </button>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? '保存中…' : '保存'}
    </button>
  );
}
