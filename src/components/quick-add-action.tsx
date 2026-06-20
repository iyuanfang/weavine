'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createActionQuick } from '@/app/actions/actions';
import { toLocalDatetimeString } from '@/lib/date-parser';
import { ContactPicker, type PickerContact } from './contact-picker';
import { DateTimeInput } from './datetime-input';
import type { ActionStatus } from '@/lib/action-status';

export function QuickAddAction({
  status,
  contacts,
}: {
  status: ActionStatus;
  contacts: PickerContact[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setTitle('');
    setContactId('');
    setDueAt(null);
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('标题必填');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createActionQuick({
        title,
        contactId: contactId || null,
        dueAt: dueAt ? toLocalDatetimeString(dueAt) : null,
        status,
      });
      if (res.ok) {
        reset();
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? '创建失败');
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded border border-dashed border-gray-300 py-2 text-sm text-gray-500 hover:border-accent hover:text-accent"
      >
        + 添加
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2 rounded border border-accent bg-white p-2 shadow-sm">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="要做的事…"
        className="input-sm w-full"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            reset();
            setOpen(false);
          }
        }}
      />
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <ContactPicker
          contacts={contacts}
          name="__unused_contact"
          defaultValue=""
          placeholder="关联人（可选）"
          allowClear
          onChangeCustom={setContactId}
        />
        <DateTimeInput
          name="__unused_due"
          value={dueAt}
          onChange={setDueAt}
          size="sm"
          showHelperText={false}
          placeholder="截止（可选）"
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex justify-end gap-1">
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? '…' : '保存'}
        </button>
      </div>
    </form>
  );
}
