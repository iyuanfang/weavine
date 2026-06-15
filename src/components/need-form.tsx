'use client';

import { useState } from 'react';
import { NeedService } from '@/server/services/need';
import type { ActionResult } from '@/lib/action';

const CATEGORIES = NeedService.CATEGORIES;

export function NeedForm({
  action,
  contacts,
  initial,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  contacts: { id: string; name: string }[];
  initial?: {
    title?: string;
    description?: string | null;
    category?: string;
    priority?: number;
    contactId?: string | null;
  };
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await action(fd);
    if (!result.ok) {
      setError(result.error ?? '操作失败');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <label className="text-sm">标题 *</label>
        <input
          name="title"
          required
          defaultValue={initial?.title ?? ''}
          className="input-base"
        />
      </div>
      <div>
        <label className="text-sm">分类 *</label>
        <select
          name="category"
          defaultValue={initial?.category ?? '合作'}
          className="input-base"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm">优先级 (0–10)</label>
        <input
          name="priority"
          type="number"
          min={0}
          max={10}
          defaultValue={initial?.priority ?? 0}
          className="input-base"
        />
      </div>
      <div className="col-span-2">
        <label className="text-sm">描述</label>
        <textarea
          name="description"
          defaultValue={initial?.description ?? ''}
          rows={4}
          className="input-base"
        />
      </div>
      {error && (
        <p className="col-span-2 text-sm text-red-600">{error}</p>
      )}
      <div className="col-span-2">
        <button disabled={saving} className="btn-primary">
          {saving ? '保存中…' : initial ? '保存' : '创建'}
        </button>
      </div>
    </form>
  );
}
