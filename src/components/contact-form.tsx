'use client';

import { useEffect, useState } from 'react';
import type { Tag } from '@prisma/client';
import type { ActionResult } from '@/lib/action';
import {
  createContactAction,
  updateContactAction,
  createTagAction,
} from '@/app/contacts/actions';

const blank = {
  nickname: '',
  name: '',
  company: '',
  title: '',
  city: '',
  email: '',
  phone: '',
  wechat: '',
  notes: '',
  importance: 'normal',
  reminderEnabled: true,
  reminderIntervalDays: '',
};

type Initial = Omit<Partial<typeof blank>, 'reminderIntervalDays' | 'reminderEnabled' | 'importance'> & {
  id?: string;
  tagIds?: string[];
  reminderEnabled?: boolean;
  reminderIntervalDays?: number | string;
  importance?: string;
};

type LocalTag = { id: string; name: string };

export function ContactForm({
  initial,
  tags,
  mode,
}: {
  initial?: Initial;
  tags: Tag[];
  mode: 'create' | 'edit';
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(() => mode === 'edit');
  const [localTags, setLocalTags] = useState<LocalTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const draftKey = `contact-form-draft-${mode}-${initial?.id ?? 'new'}`;
  const tagDraftKey = `contact-form-tags-${mode}-${initial?.id ?? 'new'}`;
  const [values, setValues] = useState(() => ({
    nickname: initial?.nickname ?? '',
    name: initial?.name ?? '',
    company: initial?.company ?? '',
    title: initial?.title ?? '',
    city: initial?.city ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    wechat: initial?.wechat ?? '',
    notes: initial?.notes ?? '',
    importance: initial?.importance ?? 'normal',
    reminderEnabled: initial?.reminderEnabled !== false,
    reminderIntervalDays: initial?.reminderIntervalDays ?? '',
  }));
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(() => new Set(initial?.tagIds ?? []));

  useEffect(() => {
    const stored = sessionStorage.getItem(draftKey);
    if (stored) {
      try {
        setValues((prev) => ({ ...prev, ...JSON.parse(stored) }));
      } catch {
        sessionStorage.removeItem(draftKey);
      }
    }
    const storedTags = sessionStorage.getItem(tagDraftKey);
    if (storedTags) {
      try {
        setSelectedTagIds(new Set(JSON.parse(storedTags)));
      } catch {
        sessionStorage.removeItem(tagDraftKey);
      }
    }
  }, [draftKey, tagDraftKey]);

  function updateValue(name: keyof typeof values, value: string) {
    const next = { ...values, [name]: value };
    setValues(next);
    sessionStorage.setItem(draftKey, JSON.stringify(next));
  }

  function updateSelectedTagIds(next: Set<string>) {
    setSelectedTagIds(next);
    sessionStorage.setItem(tagDraftKey, JSON.stringify([...next]));
  }
  const hasAdvanced =
    !!initial?.company ||
    !!initial?.name ||
    !!initial?.title ||
    !!initial?.city ||
    !!initial?.email ||
    !!initial?.phone ||
    !!initial?.wechat;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const action =
      mode === 'create'
        ? createContactAction
        : updateContactAction.bind(null, initial!.id!);
    const result: ActionResult = await action(fd);
    if (!result) {
      sessionStorage.removeItem(draftKey);
      sessionStorage.removeItem(tagDraftKey);
    }
    if (result && !result.ok) {
      setError(result.error ?? '操作失败');
      setSaving(false);
    }
  }

  async function handleAddTag() {
    const name = newTagName.trim();
    if (!name || addingTag) return;
    setAddingTag(true);
    setError(null);
    const res = await createTagAction(name);
    setAddingTag(false);
    if (!res.ok || !res.tag) {
      setError(res.error ?? '创建失败');
      return;
    }
    setLocalTags((prev) => {
      if (prev.some((t) => t.id === res.tag!.id)) return prev;
      return [...prev, { id: res.tag!.id, name: res.tag!.name }];
    });
    updateSelectedTagIds(new Set([...selectedTagIds, res.tag.id]));
    setNewTagName('');
  }

  const allTags: LocalTag[] = [
    ...tags.map((t) => ({ id: t.id, name: t.name })),
    ...localTags,
  ];

  return (
    <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Field
          label="昵称 *"
          name="nickname"
          value={values.nickname}
          onChange={(value) => updateValue('nickname', value)}
          placeholder="你平时怎么称呼TA"
        />
      </div>

      <div className="col-span-2">
        <label className="block text-sm">标签</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {allTags.map((t) => (
            <label
              key={t.id}
              className="cursor-pointer rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
            >
              <input
                type="checkbox"
                name="tagId"
                value={t.id}
                checked={selectedTagIds.has(t.id)}
                onChange={(e) => {
                  const next = new Set(selectedTagIds);
                  if (e.target.checked) next.add(t.id);
                  else next.delete(t.id);
                  updateSelectedTagIds(next);
                }}
              />{' '}
              {t.name}
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag();
              }
            }}
            placeholder="新标签名（回车添加）"
            className="input-sm flex-1"
          />
          <button
            type="button"
            onClick={handleAddTag}
            disabled={!newTagName.trim() || addingTag}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            {addingTag ? '…' : '+ 添加'}
          </button>
        </div>
      </div>

      <div className="col-span-2">
        <label className="block text-sm">备注</label>
        <textarea
          name="notes"
          value={values.notes}
          onChange={(e) => updateValue('notes', e.target.value)}
          className="input-base"
          rows={3}
        />
      </div>

      {!expanded ? (
        <div className="col-span-2">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-sm text-blue-600 hover:underline"
          >
            {hasAdvanced ? '+ 显示完整信息（公司、联系方式等）' : '+ 添加更多（公司、联系方式等）'}
          </button>
        </div>
      ) : (
        <>
          <Field
            label="姓名"
            name="name"
            value={values.name}
            onChange={(value) => updateValue('name', value)}
            placeholder="真实姓名（可选）"
          />
          <Field
            label="公司"
            name="company"
            value={values.company}
            onChange={(value) => updateValue('company', value)}
          />
          <Field
            label="职位"
            name="title"
            value={values.title}
            onChange={(value) => updateValue('title', value)}
          />
          <Field
            label="城市"
            name="city"
            value={values.city}
            onChange={(value) => updateValue('city', value)}
          />
          <Field
            label="邮箱"
            name="email"
            type="email"
            value={values.email}
            onChange={(value) => updateValue('email', value)}
          />
          <Field
            label="电话"
            name="phone"
            value={values.phone}
            onChange={(value) => updateValue('phone', value)}
          />
          <Field
            label="微信"
            name="wechat"
            value={values.wechat}
            onChange={(value) => updateValue('wechat', value)}
          />
          <div className="col-span-2 border-t pt-3 mt-2">
            <h3 className="text-sm font-medium text-gray-700 mb-2">关系维护</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm" htmlFor="importance-role">重要度</label>
                <select
                  id="importance-role"
                  name="importance"
                  value={values.importance}
                  onChange={(e) => updateValue('importance', e.target.value)}
                  className="input-base"
                >
                  <option value="important">重要</option>
                  <option value="normal">普通</option>
                  <option value="low">次要</option>
                </select>
              </div>
              <label className="flex items-center gap-2 self-end pb-1 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="reminderEnabled"
                  checked={values.reminderEnabled}
                  onChange={(e) => {
                    const next = { ...values, reminderEnabled: e.target.checked };
                    setValues(next);
                    sessionStorage.setItem(draftKey, JSON.stringify(next));
                  }}
                />
                启用关系维护提醒
              </label>
            </div>
            {values.reminderEnabled && (
              <div className="mt-2">
                <label className="block text-sm" htmlFor="reminderIntervalDays">提醒间隔（天，留空自动按重要度）</label>
                <input
                  id="reminderIntervalDays"
                  name="reminderIntervalDays"
                  type="number"
                  min={1}
                  value={values.reminderIntervalDays}
                  onChange={(e) => updateValue('reminderIntervalDays', e.target.value)}
                  className="input-base mt-1"
                  placeholder="留空则自动：重要14天/普通45天/次要90天"
                />
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="col-span-2 text-sm text-red-600">{error}</p>
      )}
      <div className="col-span-2 flex items-center gap-3">
        <button disabled={saving} className="btn-primary">
          {saving ? '保存中…' : mode === 'create' ? '创建' : '保存'}
        </button>
        {mode === 'create' && (
          <span className="text-xs text-gray-500">
            后续在联系人详情页可补全其他字段
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  value,
  onChange,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm">{label}</label>
      <input
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-base"
        {...rest}
      />
    </div>
  );
}
