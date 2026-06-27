'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { QuickLogType, ParsedIntent } from '@/lib/nl-parser';
import { quickLogAction } from '@/app/quick-log/actions';
import { ACTION_PRIORITIES, PRIORITY_LABEL } from '@/server/services/action';
import { ContactPicker, type PickerContact } from './contact-picker';
import { DateTimeInput } from './datetime-input';
import { toLocalDatetimeString } from '@/lib/date-parser';

type QuickLogInitial = {
  type: QuickLogType;
  title?: string;
  date?: Date | null;
  contactId?: string;
  contactName?: string;
  location?: string;
  channel?: string;
};

export function QuickLog({
  contacts,
  open: controlledOpen,
  initial,
  onClose,
}: {
  contacts: PickerContact[];
  open?: boolean;
  initial?: QuickLogInitial;
  onClose?: () => void;
}) {
  const [type, setType] = useState<QuickLogType>('interaction');
  const [contactId, setContactId] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [channel, setChannel] = useState('微信');
  const [summary, setSummary] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState(0);
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [startAt, setStartAt] = useState<Date | null>(null);
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const firstFieldRef = useRef<HTMLDivElement>(null);

  const open = controlledOpen ?? false;

  // Populate fields from initial values
  useEffect(() => {
    if (!open || !initial) return;
    setType(initial.type);
    setLocation(initial.location ?? '');

    if (initial.type === 'interaction') {
      setSummary(initial.title ?? '');
    } else {
      setTitle(initial.title ?? '');
    }

    if (initial.type === 'action' && initial.date) {
      setDueAt(initial.date);
    }
    if (initial.type === 'event') {
      setStartAt(initial.date ?? null);
    }

    if (initial.contactId) {
      setContactId(initial.contactId);
    }

    if (initial.channel) {
      setChannel(initial.channel);
    }
  }, [open, initial]);

  // Reset internal state when closing
  useEffect(() => {
    if (!open) {
      setContactId('');
      setNewContactName('');
      setSummary('');
      setTitle('');
      setPriority(0);
      setDueAt(null);
      setStartAt(null);
      setLocation('');
      setError(null);
      setType('interaction');
    }
  }, [open]);

  // Focus on open
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        const el = firstFieldRef.current?.querySelector<HTMLInputElement>('input,button');
        el?.focus();
      }, 100);
    }
  }, [open]);

  function switchTo(t: QuickLogType) {
    setType(t);
    setTimeout(() => {
      const el = firstFieldRef.current?.querySelector<HTMLInputElement>('input,button');
      el?.focus();
    }, 50);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const fd = new FormData();
    fd.set('type', type);
    if (contactId === '__new__') {
      if (!newContactName.trim()) {
        setError('请输入新联系人姓名');
        setSubmitting(false);
        return;
      }
      fd.set('newContactName', newContactName.trim());
    }
    fd.set('contactId', contactId);

    if (type === 'interaction') {
      fd.set('summary', summary);
      fd.set('channel', channel);
    } else if (type === 'action') {
      fd.set('title', title);
      fd.set('priority', String(priority));
      if (dueAt) fd.set('dueAt', toLocalDatetimeString(dueAt));
    } else if (type === 'event') {
      fd.set('title', title);
      if (startAt) fd.set('startAt', toLocalDatetimeString(startAt));
      if (location) fd.set('location', location);
    }

    const res = await quickLogAction(fd);
    setSubmitting(false);

    if (res.ok) {
      onClose?.();
      startTransition(() => router.refresh());
    } else {
      setError(res.error ?? '创建失败');
    }
  }

  const tabs: { key: QuickLogType; label: string }[] = [
    { key: 'interaction', label: ' 互动' },
    { key: 'action', label: '☑ 待办' },
    { key: 'event', label: ' 日程' },
  ];

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20"
          onClick={() => onClose?.()}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => switchTo(t.key)}
                  className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                    type === t.key
                      ? 'bg-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div ref={firstFieldRef}>
                <label className="block text-sm text-gray-600">联系人</label>
                <ContactPicker
                  contacts={contacts}
                  name="contactId"
                  onChangeCustom={(v) => {
                    setContactId(v);
                    if (v !== '__new__') setNewContactName('');
                  }}
                />
                <button
                  type="button"
                  className="mt-1 text-xs text-blue-600 hover:underline"
                  onClick={() => setContactId('__new__')}
                >
                  + 创建新联系人…
                </button>
                {contactId === '__new__' && (
                  <>
                    <input type="hidden" name="contactId" value="__new__" />
                    <input
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      className="input-base mt-1 w-full"
                      placeholder="输入联系人姓名"
                      autoFocus
                      name="newContactName"
                    />
                  </>
                )}
              </div>

              {type === 'interaction' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-600">渠道</label>
                    <select
                      value={channel}
                      onChange={(e) => setChannel(e.target.value)}
                      className="input-base"
                    >
                      <option>微信</option>
                      <option>电话</option>
                      <option>线下</option>
                      <option>邮件</option>
                      <option>思考</option>
                      <option>其他</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600">内容</label>
                    <textarea
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      className="input-base"
                      rows={3}
                      placeholder="聊了什么、进展、下一步..."
                    />
                  </div>
                </>
              )}

              {type === 'action' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-600">标题</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="input-base w-full"
                      placeholder="要做的事..."
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm text-gray-600">优先级</label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(Number(e.target.value))}
                        className="input-base w-full"
                      >
                        {ACTION_PRIORITIES.map((p) => (
                          <option key={p} value={p}>P{p} {PRIORITY_LABEL[p]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <DateTimeInput
                        name="__quick_due"
                        value={dueAt}
                        onChange={setDueAt}
                        showHelperText={false}
                        placeholder="截止（可选）"
                      />
                    </div>
                  </div>
                </>
              )}

              {type === 'event' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-600">标题</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="input-base w-full"
                      placeholder="日程标题..."
                    />
                  </div>
                  <div>
                    <DateTimeInput
                      name="__quick_start"
                      label="开始时间"
                      required
                      value={startAt}
                      onChange={setStartAt}
                      showHelperText={false}
                      placeholder="明天下午3点 / 周六上午10点"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600">地点</label>
                    <input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="input-base w-full"
                      placeholder="选填"
                    />
                  </div>
                </>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => onClose?.()} className="btn-secondary">
                  取消
                </button>
                <button type="submit" disabled={submitting} className="btn-primary">
                  {submitting ? '创建中…' : '创建'}
                </button>
              </div>
            </form>

            <p className="mt-3 text-xs text-gray-400">
              按 <kbd className="rounded border bg-gray-50 px-1">Esc</kbd> 关闭
            </p>
          </div>
        </div>
      )}
    </>
  );
}
