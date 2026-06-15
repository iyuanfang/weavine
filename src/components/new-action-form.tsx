'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { createAction } from '@/app/actions/actions';
import { parseDateNL } from '@/lib/date-parser';
import type { ActionResult } from '@/lib/action';

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn-primary">
      {pending ? '保存中…' : '保存'}
    </button>
  );
}

export function NewActionForm({
  contacts,
}: {
  contacts: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState(
    createAction as unknown as (
      prev: ActionResult,
      fd: FormData,
    ) => Promise<ActionResult>,
    { ok: true, data: null } as ActionResult,
  );

  const [dueText, setDueText] = useState('');
  const [parsed, setParsed] = useState<string>('');
  const [resolvedDate, setResolvedDate] = useState<string>('');

  function onDueBlur() {
    if (!dueText.trim()) {
      setParsed('');
      setResolvedDate('');
      return;
    }
    const r = parseDateNL(dueText);
    if (r) {
      const iso = r.date.toISOString().slice(0, 16);
      setParsed(`${r.source}: ${dueText} → ${r.date.toLocaleString('zh-CN')}`);
      setResolvedDate(iso);
    } else {
      setParsed('无法解析，请用 YYYY-MM-DD HH:mm 或 "明天下午3点" 这种');
      setResolvedDate('');
    }
  }

  return (
    <form action={formAction} className="mt-4 grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <label className="text-sm">标题 *</label>
        <input name="title" required className="input-base" placeholder="例：发合同给李四" />
      </div>

      <div>
        <label className="text-sm">状态</label>
        <select name="status" defaultValue="inbox" className="input-base">
          <option value="inbox">📥 收件箱</option>
          <option value="open">🎯 待办</option>
          <option value="waiting">⏳ 等待回复</option>
        </select>
      </div>

      <div>
        <label className="text-sm">优先级 (0–10)</label>
        <input name="priority" type="number" min={0} max={10} defaultValue={0} className="input-base" />
      </div>

      <div>
        <label className="text-sm">截止时间</label>
        <input
          value={dueText}
          onChange={(e) => setDueText(e.target.value)}
          onBlur={onDueBlur}
          placeholder="明天下午3点 / 2026-06-20 14:00"
          className="input-base"
        />
        {parsed && <p className="mt-1 text-xs text-gray-500">{parsed}</p>}
        {resolvedDate && <input type="hidden" name="dueAt" value={resolvedDate} />}
      </div>

      <div>
        <label className="text-sm">分类</label>
        <input name="category" placeholder="合作 / 学习 / 健康 / 其他" className="input-base" />
      </div>

      <div>
        <label className="text-sm">关联人（我答应他的）</label>
        <select name="contactId" defaultValue="" className="input-base">
          <option value="">无</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm">在等谁</label>
        <select name="waitingOnId" defaultValue="" className="input-base">
          <option value="">无</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="col-span-2">
        <label className="text-sm">描述</label>
        <textarea name="description" rows={3} className="input-base" />
      </div>

      {state && !state.ok && <p className="col-span-2 text-sm text-red-600">{state.error}</p>}

      <div className="col-span-2">
        <SubmitBtn />
      </div>
    </form>
  );
}
