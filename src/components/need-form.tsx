'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { NeedService } from '@/server/services/need';
import type { ActionResult } from '@/lib/action';

const CATEGORIES = NeedService.CATEGORIES;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn-primary disabled:opacity-50">
      {label}
    </button>
  );
}

export function NeedForm({
  action,
  contacts,
  initial,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
  contacts: { id: string; name: string }[];
  initial?: {
    title?: string;
    description?: string | null;
    category?: string;
    priority?: number;
    contactId?: string | null;
  };
}) {
  const [state, formAction] = useFormState(
    action as unknown as (
      prev: ActionResult,
      fd: FormData,
    ) => Promise<ActionResult>,
    { ok: true, data: null } as ActionResult,
  );

  return (
    <form action={formAction} className="mt-4 grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <label className="text-sm">标题 *</label>
        <input
          name="title"
          required
          defaultValue={initial?.title ?? ''}
          className="input-base mt-1 w-full"
        />
      </div>
      <div>
        <label className="text-sm">分类 *</label>
        <select
          name="category"
          defaultValue={initial?.category ?? '合作'}
          className="input-base mt-1 w-full"
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
          className="input-base mt-1 w-full"
        />
      </div>
      <div className="col-span-2">
        <label className="text-sm">描述</label>
        <textarea
          name="description"
          defaultValue={initial?.description ?? ''}
          rows={4}
          className="input-base mt-1 w-full"
        />
      </div>
      {state && !state.ok && (
        <p className="col-span-2 text-sm text-red-600">{state.error}</p>
      )}
      <div className="col-span-2">
        <Submit label={initial ? '保存' : '创建'} />
      </div>
    </form>
  );
}
