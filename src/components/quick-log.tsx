'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { classifyInput, type QuickLogType } from '@/lib/nl-classify';
import { quickLogAction } from '@/app/quick-log/actions';

type Contact = { id: string; name: string };

export function QuickLog({ contacts }: { contacts: Contact[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<QuickLogType>('interaction');
  const [contactId, setContactId] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [channel, setChannel] = useState('微信');
  const [summary, setSummary] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState(0);
  const [dueAt, setDueAt] = useState('');
  const [startAt, setStartAt] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // ⌘K toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus + reset on open
  useEffect(() => {
    if (open) {
      setTimeout(() => firstFieldRef.current?.focus(), 100);
    } else {
      setContactId('');
      setNewContactName('');
      setSummary('');
      setTitle('');
      setPriority(0);
      setDueAt('');
      setStartAt('');
      setLocation('');
      setError(null);
      setType('interaction');
    }
  }, [open]);

  // Auto-classify on summary/title change
  useEffect(() => {
    const text = type === 'interaction' ? summary : title;
    if (text.length >= 2) {
      setType(classifyInput(text));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, title]);

  function switchTo(t: QuickLogType) {
    setType(t);
    setTimeout(() => firstFieldRef.current?.focus(), 50);
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
      if (dueAt) fd.set('dueAt', dueAt);
    } else if (type === 'event') {
      fd.set('title', title);
      fd.set('startAt', startAt);
      if (location) fd.set('location', location);
    }

    const res = await quickLogAction(fd);
    setSubmitting(false);

    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? '创建失败');
    }
  }

  const tabs: { key: QuickLogType; label: string }[] = [
    { key: 'interaction', label: ' 记录' },
    { key: 'action', label: '☑ 待办' },
    { key: 'event', label: ' 日程' },
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary flex items-center gap-1"
        title="快速输入 (⌘K)"
      >
        <span>+ 快速</span>
        <kbd className="ml-1 rounded border border-gray-300 bg-gray-50 px-1 text-xs text-gray-500">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Type tabs — auto-classified */}
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
              {/* Contact — common */}
              <div>
                <label className="block text-sm text-gray-600">联系人</label>
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className="input-base"
                  ref={firstFieldRef}
                >
                  <option value="">无（纯想法）</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new__">+ 创建新联系人...</option>
                </select>
                {contactId === '__new__' && (
                  <input
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    className="input-base mt-1 w-full"
                    placeholder="输入联系人姓名"
                    autoFocus
                  />
                )}
              </div>

              {/* 记录 fields */}
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

              {/* 待办 fields */}
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
                      <label className="block text-sm text-gray-600">
                        优先级
                      </label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(Number(e.target.value))}
                        className="input-base w-full"
                      >
                        <option value={0}>普通</option>
                        <option value={1}>P1 重要</option>
                        <option value={2}>P2 紧急</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm text-gray-600">
                        截止
                      </label>
                      <input
                        type="datetime-local"
                        value={dueAt}
                        onChange={(e) => setDueAt(e.target.value)}
                        className="input-base w-full"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* 日程 fields */}
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
                    <label className="block text-sm text-gray-600">
                      开始时间
                    </label>
                    <input
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                      className="input-base w-full"
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
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary"
                >
                  {submitting ? '创建中…' : '创建'}
                </button>
              </div>
            </form>

            <p className="mt-3 text-xs text-gray-400">
              按{' '}
              <kbd className="rounded border bg-gray-50 px-1">Esc</kbd>{' '}
              关闭 · 输入内容会自动识别类型
            </p>
          </div>
        </div>
      )}
    </>
  );
}
