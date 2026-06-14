'use client';

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
  const start = initial?.startAt
    ? new Date(initial.startAt).toISOString().slice(0, 16)
    : defaultStart ?? '';
  const end = initial?.endAt
    ? new Date(initial.endAt).toISOString().slice(0, 16)
    : '';

  return (
    <form action={action} className="mt-4 grid grid-cols-2 gap-3">
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

      <div className="col-span-2">
        <button className="btn-primary">保存</button>
      </div>
    </form>
  );
}
