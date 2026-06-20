'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createTag, renameTag, deleteTag } from './actions';
import { tagColor } from '@/lib/tag-color';
import { ConfirmDeleteForm } from '@/components/confirm-delete';
import type { Tag } from '@prisma/client';
import { useState } from 'react';

export function TagsPageClient({
  tags,
}: {
  tags: (Tag & { _count: { contacts: number } })[];
}) {
  const [createState, createFormAction] = useFormState(createTag, undefined);
  const [newName, setNewName] = useState('');

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">标签</h1>

      <form action={createFormAction} className="mt-4 flex gap-2">
        <input
          name="name"
          required
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新标签名"
          className="input-base flex-1"
        />
        <SubmitButton label="添加" />
      </form>
      {createState && !createState.ok && (
        <p className="mt-2 text-sm text-red-600">{createState.error}</p>
      )}

      <ul className="mt-4 divide-y">
        {tags.map((t) => (
          <TagRow key={t.id} tag={t} />
        ))}
        {tags.length === 0 && (
          <li className="py-6 text-center text-sm text-gray-500">
            暂无标签，创建一个开始分类。
          </li>
        )}
      </ul>
    </main>
  );
}

function TagRow({ tag }: { tag: Tag & { _count: { contacts: number } } }) {
  const [renameState, renameFormAction] = useFormState(
    renameTag.bind(null, tag.id),
    undefined,
  );
  const [name, setName] = useState(tag.name);

  return (
    <li className="flex items-center gap-3 py-2">
      <span
        className="badge"
        style={{ background: tagColor(tag.name).bg, color: tagColor(tag.name).text }}
      >
        {tag.name}
      </span>
      <span className="text-sm text-gray-500">
        {tag._count.contacts} 人
      </span>

      <form action={renameFormAction} className="ml-auto flex gap-1">
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input-sm w-24"
        />
        <button className="btn-secondary">改名</button>
      </form>
      {renameState && !renameState.ok && (
        <p className="text-xs text-red-600">{renameState.error}</p>
      )}

      <ConfirmDeleteForm action={deleteTag.bind(null, tag.id)}>
        <button className="btn-danger" aria-label="删除">删除</button>
      </ConfirmDeleteForm>
    </li>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn-primary">
      {pending ? '…' : label}
    </button>
  );
}
