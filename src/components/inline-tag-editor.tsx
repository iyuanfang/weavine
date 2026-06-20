'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tagColor } from '@/lib/tag-color';
import { createTagAction, attachTagAction, detachTagAction } from '@/app/contacts/actions';

export type ContactTag = { id: string; name: string };

export function InlineTagEditor({
  contactId,
  initialTags,
  ownerTags,
}: {
  contactId: string;
  initialTags: ContactTag[];
  ownerTags: ContactTag[];
}) {
  const router = useRouter();
  const [tags, setTags] = useState<ContactTag[]>(initialTags);
  const [knownTags, setKnownTags] = useState<ContactTag[]>(ownerTags);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const knownIds = new Set(tags.map((t) => t.id));
  const suggestions = knownTags.filter((t) => !knownIds.has(t.id));

  async function attach(tagId: string, name: string) {
    setBusy(true);
    setError(null);
    const res = await attachTagAction(contactId, tagId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? '添加失败');
      return;
    }
    setTags((prev) => (prev.some((t) => t.id === tagId) ? prev : [...prev, { id: tagId, name }]));
  }

  async function detach(tagId: string) {
    setBusy(true);
    setError(null);
    const res = await detachTagAction(contactId, tagId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? '删除失败');
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== tagId));
  }

  async function addNew() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const res = await createTagAction(name);
    setBusy(false);
    if (!res.ok || !res.tag) {
      setError(res.error ?? '创建失败');
      return;
    }
    setKnownTags((prev) => {
      if (prev.some((t) => t.id === res.tag!.id)) return prev;
      return [...prev, { id: res.tag!.id, name: res.tag!.name }];
    });
    await attach(res.tag.id, res.tag.name);
    setNewName('');
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((t) => {
          const tc = tagColor(t.name);
          return (
            <span
              key={t.id}
              className="badge inline-flex items-center gap-1"
              style={{ background: tc.bg, color: tc.text }}
            >
              {t.name}
              <button
                type="button"
                aria-label={`移除标签 ${t.name}`}
                disabled={busy}
                onClick={() => detach(t.id)}
                className="rounded-full px-1 text-xs leading-none hover:bg-black/10 disabled:opacity-50"
              >
                ×
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          disabled={busy}
          className="rounded border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-accent hover:text-accent disabled:opacity-50"
        >
          + 标签
        </button>
      </div>

      {pickerOpen && (
        <div className="mt-2 rounded border border-gray-200 bg-white p-2 shadow-sm">
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((t) => {
                const tc = tagColor(t.name);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={busy}
                    onClick={() => attach(t.id, t.name)}
                    className="badge inline-flex items-center hover:opacity-80 disabled:opacity-50"
                    style={{ background: tc.bg, color: tc.text }}
                  >
                    + {t.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addNew();
                }
              }}
              placeholder="新标签（回车添加并关联）"
              className="input-sm flex-1"
            />
            <button
              type="button"
              onClick={addNew}
              disabled={!newName.trim() || busy}
              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
            >
              {busy ? '…' : '添加'}
            </button>
          </div>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
      {error && !pickerOpen && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
