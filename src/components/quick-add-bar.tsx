'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createActionQuick } from '@/app/actions/actions';
import { ContactPicker, type PickerContact } from './contact-picker';
import { DateTimeInput } from './datetime-input';

export function QuickAddBar({
  contacts,
}: {
  contacts: PickerContact[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reset() {
    setTitle('');
    setContactId(null);
    setDueAt(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('标题必填');
      return;
    }
    setSaving(true);
    setError(null);
    const r = await createActionQuick({
      title: title.trim(),
      contactId,
      dueAt: dueAt ? new Date(dueAt.getTime() - new Date().getTimezoneOffset() * 60000).toISOString() : null,
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error || '创建失败');
      return;
    }
    reset();
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-500 transition-all hover:border-accent hover:bg-accent/5 hover:text-accent"
      >
        + 新建待办
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="quick-add-form mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 shadow-sm"
    >
      <input
        autoFocus
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="待办标题…"
        className="input-base"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <DateTimeInput
          name="dueAt"
          value={dueAt}
          onChange={setDueAt}
          label="截止"
          placeholder="明天下午3点"
          size="sm"
          showHelperText={false}
        />
        <div>
          <label className="text-xs text-gray-500">关联人</label>
          <div className="mt-1">
            <ContactPicker contacts={contacts} name="contactId" onChangeCustom={setContactId} />
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="btn-secondary text-sm"
        >
          取消
        </button>
        <button type="submit" disabled={saving} className="btn-primary text-sm">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}