'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { Tag } from '@prisma/client';
import type { ActionResult } from '@/lib/action';
import {
  createContactAction,
  updateContactAction,
} from '@/app/contacts/actions';

const blank = {
  name: '',
  company: '',
  title: '',
  city: '',
  email: '',
  phone: '',
  wechat: '',
  birthdayMonth: '',
  birthdayDay: '',
  notes: '',
};

type Initial = Partial<typeof blank> & {
  id?: string;
  tagIds?: string[];
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn-primary">
      {label}
    </button>
  );
}

export function ContactForm({
  initial,
  tags,
  mode,
}: {
  initial?: Initial;
  tags: Tag[];
  mode: 'create' | 'edit';
}) {
  const action =
    mode === 'create'
      ? createContactAction
      : mode === 'edit' && initial?.id
        ? updateContactAction.bind(null, initial.id)
        : createContactAction;

  const [state, formAction] = useFormState(
    action as unknown as (
      prev: ActionResult,
      fd: FormData,
    ) => Promise<ActionResult>,
    { ok: true, data: null } as ActionResult,
  );

  return (
    <form action={formAction} className="mt-4 grid grid-cols-2 gap-3">
      <Field label="姓名 *" name="name" defaultValue={initial?.name} />
      <Field label="公司" name="company" defaultValue={initial?.company} />
      <Field label="职位" name="title" defaultValue={initial?.title} />
      <Field label="城市" name="city" defaultValue={initial?.city} />
      <Field
        label="邮箱"
        name="email"
        type="email"
        defaultValue={initial?.email}
      />
      <Field label="电话" name="phone" defaultValue={initial?.phone} />
      <Field label="微信" name="wechat" defaultValue={initial?.wechat} />
      <Field
        label="生日 月"
        name="birthdayMonth"
        type="number"
        min={1}
        max={12}
        defaultValue={initial?.birthdayMonth}
      />
      <Field
        label="生日 日"
        name="birthdayDay"
        type="number"
        min={1}
        max={31}
        defaultValue={initial?.birthdayDay}
      />
      <div className="col-span-2">
        <label className="block text-sm">标签</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {tags.map((t) => (
            <label
              key={t.id}
              className="cursor-pointer rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
            >
              <input
                type="checkbox"
                name="tagId"
                value={t.id}
                defaultChecked={initial?.tagIds?.includes(t.id)}
              />{' '}
              {t.name}
            </label>
          ))}
        </div>
      </div>
      <div className="col-span-2">
        <label className="block text-sm">备注</label>
        <textarea
          name="notes"
          defaultValue={initial?.notes}
          className="input-base"
          rows={4}
        />
      </div>
      {state && !state.ok && (
        <p className="col-span-2 text-sm text-red-600">{state.error}</p>
      )}
      <div className="col-span-2">
        <Submit label={mode === 'create' ? '创建' : '保存'} />
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  [key: string]: any;
}) {
  return (
    <div>
      <label className="block text-sm">{label}</label>
      <input name={name} type={type} className="input-base" {...rest} />
    </div>
  );
}
