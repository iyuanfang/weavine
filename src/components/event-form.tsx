'use client';

import { useState } from 'react';
import type { ActionResult } from '@/lib/action';
import { DateTimeInput } from './datetime-input';
import { ContactPicker, type PickerContact } from './contact-picker';
import { DatalistInput } from './datalist-input';
import { EVENT_TYPE_OPTIONS, DEFAULT_EVENT_TYPE } from '@/lib/event-type';

interface Initial {
  title?: string;
  type?: string;
  startAt?: string;
  endAt?: string | null;
  location?: string | null;
  notes?: string | null;
  contactId?: string | null;
}

export function EventForm({
  action,
  contacts,
  initial,
  defaultStart,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  contacts: PickerContact[];
  initial?: Initial;
  defaultStart?: string;
}) {
  const [{ saving, error }, setState] = useState({ saving: false, error: null as string | null });
  const [startDate, setStartDate] = useState<Date | null>(
    initial?.startAt ? new Date(initial.startAt) : defaultStart ? new Date(defaultStart) : null,
  );
  const [endDate, setEndDate] = useState<Date | null>(
    initial?.endAt ? new Date(initial.endAt) : null,
  );
  const [type, setType] = useState<string>(initial?.type ?? '');

  function handleStartChange(d: Date | null) {
    setStartDate(d);
    if (!d) return;
    if (!endDate) {
      setEndDate(new Date(d.getTime() + 60 * 60 * 1000));
    } else if (endDate <= d) {
      setEndDate(new Date(d.getTime() + 60 * 60 * 1000));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ saving: true, error: null });
    const fd = new FormData(e.currentTarget);
    const result = await action(fd);
    if (result && !result.ok) {
      setState({ saving: false, error: result.error ?? '保存失败' });
    }
  }

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
        <DatalistInput
          name="type"
          value={type}
          onChange={setType}
          options={EVENT_TYPE_OPTIONS}
          placeholder="选一个或输入自定义类型"
          required
          className="input-base mt-1"
        />
      </div>

      <div>
        <label className="text-sm font-medium">地点</label>
        <input
          name="location"
          defaultValue={initial?.location ?? ''}
          className="input-base"
        />
      </div>

      <div className="col-span-2">
        <DateTimeInput
          name="startAt"
          label="开始时间"
          required
          value={startDate}
          onChange={handleStartChange}
        />
      </div>

      <div className="col-span-2">
        <DateTimeInput
          name="endAt"
          label="结束（可选）"
          value={endDate}
          onChange={setEndDate}
          required={false}
        />
      </div>

      <div className="col-span-2">
        <label className="text-sm font-medium">联系人</label>
        <div className="mt-1">
          <ContactPicker
            contacts={contacts}
            name="contactId"
            defaultValue={initial?.contactId ?? ''}
            placeholder="搜索：昵称 / 姓名 / 公司 / 城市"
          />
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
          📌 自动创建会前待办（可选）
        </summary>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div className="col-span-2">
            <label className="text-xs">待办标题</label>
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
          填了标题就会自动创建一条待办，截止时间 = 日程开始 - 提前量，关联到第一个参与人。
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