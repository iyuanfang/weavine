'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Contact = { id: string; name: string };

export function QuickLog({ contacts }: { contacts: Contact[] }) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState('');
  const [channel, setChannel] = useState('微信');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLSelectElement>(null);

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

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setContactId('');
      setSummary('');
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactId || !summary.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set('occurredAt', new Date().toISOString());
    fd.set('channel', channel);
    fd.set('summary', summary);
    const res = await fetch(`/api/contacts/${contactId}/interactions`, {
      method: 'POST',
      body: fd,
    });
    if (res.ok) {
      setOpen(false);
      startTransition(() => router.refresh());
    } else {
      setError('记录失败，请稍后再试');
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary flex items-center gap-1"
        title="快速记录 (⌘K)"
      >
        <span>+ 记录</span>
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
            <h2 className="mb-3 text-lg font-semibold">快速记录互动</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600">联系人</label>
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  required
                  className="input-base"
                  ref={inputRef}
                >
                  <option value="">选择联系人</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
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
                  <option>其他</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600">概要</label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  required
                  rows={3}
                  className="input-base"
                  placeholder="聊了什么、进展、下一步..."
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button type="submit" disabled={isPending} className="btn-primary">
                  {isPending ? '记录中…' : '记录'}
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
