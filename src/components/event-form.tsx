'use client';

import { useState } from 'react';
import type { Contact } from '@prisma/client';
import type { ActionResult } from '@/lib/action';

interface Initial {
  title?: string;
  type?: string;
  startAt?: string;
  endAt?: string | null;
  location?: string | null;
  notes?: string | null;
  attendees?: { contactId: string }[];
}

export function EventForm({
  action,
  contacts,
  initial,
  defaultStart,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  contacts: Pick<Contact, 'id' | 'name'>[];
  initial?: Initial;
  defaultStart?: string;
}) {
  const [{ saving, error }, setState] = useState({ saving: false, error: null as string | null });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ saving: true, error: null });
    const fd = new FormData(e.currentTarget);
    const result = await action(fd);
    if (!result.ok) {
      setState({ saving: false, error: result.error ?? '保存失败' });
    } else {
      setState({ saving: false, error: null });
    }
  }

  const start = initial?.startAt
    ? new Date(initial.startAt).toISOString().slice(0, 16)
    : defaultStart ?? '';
  const end = initial?.endAt
    ? new Date(initial.endAt).toISOString().slice(0, 16)
    : '';

  return (
    <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 gap-3">
      {error && (
        <div className="col-span-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="col-span-2">
        <label className="text-sm font-medium">标题 *</label>
        <input
          name="title"
          required
          defaultValue={initial?.title ?? ''}
          className="input-base"
        />
      </div>

      <div>
        <label className="text-sm font-medium">类型</label>
        <select
          name="type"
          defaultValue={initial?.type ?? 'meeting'}
          className="input-base"
        >
          <option value="meeting">会面</option>
          <option value="birthday">生日</option>
          <option value="anniversary">纪念日</option>
          <option value="reminder">提醒</option>
          <option value="custom">其他</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-medium">地点</label>
        <input
          name="location"
          defaultValue={initial?.location ?? ''}
          className="input-base"
        />
      </div>

      <div>
        <label className="text-sm font-medium">开始 *</label>
        <input
          name="startAt"
          type="datetime-local"
          required
          defaultValue={start}
          className="input-base"
        />
      </div>

      <div>
        <label className="text-sm font-medium">结束</label>
        <input
          name="endAt"
          type="datetime-local"
          defaultValue={end}
          className="input-base"
        />
      </div>

      <div className="col-span-2">
        <label className="text-sm font-medium">参与人</label>
        <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded border border-gray-300 p-2">
          {contacts.map((c) => (
            <label key={c.id} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                name="attendeeId"
                value={c.id}
                defaultChecked={initial?.attendees?.some(
                  (a) => a.contactId === c.id,
                )}
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>

      <div className="col-span-2">
        <label className="text-sm font-medium">备注</label>
        <textarea
          name="notes"
          defaultValue={initial?.notes ?? ''}
          className="input-base"
          rows={4}
        />
      </div>

      <details className="col-span-2 rounded border border-gray-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          📌 自动创建会前 Action（可选）
        </summary>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div className="col-span-2">
            <label className="text-xs">Action 标题</label>
            <input
              name="followupTitle"
              placeholder="例：会前准备上次的讨论提纲"
              className="input-sm mt-1 w-full"
            />
          </div>
          <div>
            <label className="text-xs">提前（分钟）</label>
            <select name="followupOffsetMinutes" defaultValue="1440" className="input-sm mt-1 w-full">
              <option value="60">1 小时</option>
              <option value="120">2 小时</option>
              <option value="1440">1 天</option>
              <option value="2880">2 天</option>
              <option value="10080">1 周</option>
            </select>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          填了标题就会自动创建一条 Action，截止时间 = 事件开始 - 提前量，关联到第一个参与人。
        </p>
      </details>

      <div className="col-span-2">
        <button disabled={saving} className="btn-primary">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}
