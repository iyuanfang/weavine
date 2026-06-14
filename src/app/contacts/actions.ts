'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ContactService, type ContactInput } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { ValidationError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action';

export async function createContactAction(
  _: unknown,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const input = parseContactInput(fd);
    const prismaDb = (await import('@/lib/prisma')).prisma;
    const c = await ContactService.create(input, prismaDb);
    const tags = fd.getAll('tagId').map(String).filter(Boolean);
    for (const t of tags) {
      await TagService.attach(c.id, t, prismaDb);
    }
    revalidatePath('/contacts');
    redirect(`/contacts/${c.id}`);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    console.error('createContactAction error:', e);
    return { ok: false, error: '创建失败' };
  }
}

export async function updateContactAction(
  id: string,
  _: unknown,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const input = parseContactInput(fd);
    const prismaDb = (await import('@/lib/prisma')).prisma;
    await ContactService.update(id, input, prismaDb);

    const newTagIds = new Set(fd.getAll('tagId').map(String).filter(Boolean));
    const current = await TagService.forContact(id, prismaDb);
    for (const ct of current) {
      if (!newTagIds.has(ct.tagId)) {
        await TagService.detach(id, ct.tagId, prismaDb);
      }
    }
    for (const t of newTagIds) {
      await TagService.attach(id, t, prismaDb);
    }

    revalidatePath('/contacts');
    revalidatePath(`/contacts/${id}`);
    redirect(`/contacts/${id}`);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    console.error('updateContactAction error:', e);
    return { ok: false, error: '更新失败' };
  }
}

export async function deleteContactAction(id: string) {
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await ContactService.remove(id, prismaDb);
  revalidatePath('/contacts');
  redirect('/contacts');
}

function parseContactInput(fd: FormData): ContactInput {
  const num = (k: string) => {
    const v = fd.get(k);
    if (v === null || v === '' || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  return {
    name: String(fd.get('name') ?? ''),
    company: (fd.get('company') as string) || null,
    title: (fd.get('title') as string) || null,
    city: (fd.get('city') as string) || null,
    email: (fd.get('email') as string) || null,
    phone: (fd.get('phone') as string) || null,
    wechat: (fd.get('wechat') as string) || null,
    birthdayMonth: num('birthdayMonth'),
    birthdayDay: num('birthdayDay'),
    notes: (fd.get('notes') as string) || null,
  } as ContactInput;
}
