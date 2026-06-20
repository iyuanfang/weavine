'use client';

import { useState } from 'react';
import { createAction } from '@/app/actions/actions';
import { ACTION_PRIORITIES, PRIORITY_LABEL, ACTION_STATUSES } from '@/server/services/action';
import { ACTION_STATUS_LABEL, type ActionStatus } from '@/lib/action-status';
import { ContactPicker, type PickerContact } from './contact-picker';
import { DateTimeInput } from './datetime-input';
import { DatalistInput } from './datalist-input';
import { ACTION_CATEGORY_OPTIONS } from '@/lib/action-category';

export function NewActionForm({
  contacts,
  defaultContactId,
}: {
  contacts: PickerContact[];
  defaultContactId?: string;
}) {
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await createAction(fd);
    if (result && !result.ok) {
      setError(result.error ?? '创建失败');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <label className="text-sm">标题 *</label>
        <input name="title" required className="input-base" placeholder="例：发合同给李四" />
      </div>

      <div>
        <label className="text-sm">状态</label>
        <select name="status" defaultValue="inbox" className="input-base">
          {ACTION_STATUSES.filter((s) => s !== 'dropped').map((s) => (
            <option key={s} value={s}>{ACTION_STATUS_LABEL[s as ActionStatus]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm">优先级</label>
        <select name="priority" defaultValue={0} className="input-base">
          {ACTION_PRIORITIES.map((p) => (
            <option key={p} value={p}>P{p} {PRIORITY_LABEL[p]}</option>
          ))}
        </select>
      </div>

      <div className="col-span-2">
        <DateTimeInput
          name="dueAt"
          label="截止时间"
          value={dueAt}
          onChange={setDueAt}
          showHelperText
          placeholder="明天下午3点 / 2026-06-20 14:00"
        />
      </div>

      <div>
        <label className="text-sm">分类</label>
        <div className="mt-1">
          <DatalistInput
            name="category"
            value={category}
            onChange={setCategory}
            options={ACTION_CATEGORY_OPTIONS}
            placeholder="合作 / 学习 / 自定义..."
          />
        </div>
      </div>

      <div>
        <label className="text-sm">关联人（我答应他的）</label>
        <ContactPicker contacts={contacts} name="contactId" defaultValue={defaultContactId ?? ''} />
      </div>

      <div className="col-span-2">
        <label className="text-sm">描述</label>
        <textarea name="description" rows={3} className="input-base" />
      </div>

      {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}

      <div className="col-span-2">
        <button disabled={saving} className="btn-primary">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}