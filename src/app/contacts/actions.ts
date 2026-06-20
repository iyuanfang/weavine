'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isRedirectError } from 'next/dist/client/components/redirect';
import { Prisma } from '@prisma/client';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { ValidationError } from '@/lib/errors';
import { ZodError } from 'zod';
import type { ActionResult } from '@/lib/action';
import { getCurrentUser } from '@/lib/auth/session';
import { parseContactInput } from './input';

export async function createContactAction(
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    const input = parseContactInput(fd);
    const prismaDb = (await import('@/lib/prisma')).prisma;
    const c = await ContactService.create(input, ownerId, prismaDb);
    const tags = fd.getAll('tagId').map(String).filter(Boolean);
    await Promise.all(tags.map(t => TagService.attach(c.id, t, ownerId, prismaDb)));
    revalidatePath('/contacts');
    redirect(`/contacts/${c.id}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' };
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    console.error('createContactAction error:', e);
    return { ok: false, error: '创建失败' };
  }
}

export async function updateContactAction(
  id: string,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    const input = parseContactInput(fd);
    const prismaDb = (await import('@/lib/prisma')).prisma;
    await ContactService.update(id, input, ownerId, prismaDb);

    const newTagIds = new Set(fd.getAll('tagId').map(String).filter(Boolean));
    const current = await TagService.forContact(id, ownerId, prismaDb);
    const currentIds = new Set(current.map(ct => ct.tagId));
    const toDetach = current.filter(ct => !newTagIds.has(ct.tagId)).map(ct => ct.tagId);
    const toAttach = [...newTagIds].filter(t => !currentIds.has(t));
    await Promise.all([
      ...toDetach.map(t => TagService.detach(id, t, ownerId, prismaDb)),
      ...toAttach.map(t => TagService.attach(id, t, ownerId, prismaDb)),
    ]);

    revalidatePath('/contacts');
    revalidatePath(`/contacts/${id}`);
    redirect(`/contacts/${id}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' };
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    console.error('updateContactAction error:', e);
    return { ok: false, error: '更新失败' };
  }
}

export async function createTagAction(
  name: string,
): Promise<{ ok: boolean; tag?: { id: string; name: string; color: string | null }; error?: string }> {
  try {
    const { id: ownerId } = await getCurrentUser();
    const cleaned = name.trim();
    if (!cleaned) return { ok: false, error: '标签名不能为空' };
    if (cleaned.length > 40) return { ok: false, error: '标签名最多 40 字' };
    const prismaDb = (await import('@/lib/prisma')).prisma;
    const existing = await prismaDb.tag.findFirst({ where: { ownerId, name: cleaned } });
    if (existing) return { ok: true, tag: { id: existing.id, name: existing.name, color: existing.color } };
    const palette = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#6b7280'];
    const color = palette[Math.abs(hashCode(cleaned)) % palette.length];
    const tag = await TagService.create({ name: cleaned, color }, ownerId, prismaDb);
    revalidatePath('/tags');
    return { ok: true, tag: { id: tag.id, name: tag.name, color: tag.color } };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' };
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: '已存在同名标签' };
    }
    console.error('createTagAction error:', e);
    return { ok: false, error: '创建失败' };
  }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

export async function attachTagAction(
  contactId: string,
  tagId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { id: ownerId } = await getCurrentUser();
    await TagService.attach(contactId, tagId, ownerId);
    revalidatePath(`/contacts/${contactId}`);
    return { ok: true };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error('attachTagAction error:', e);
    return { ok: false, error: '添加失败' };
  }
}

export async function detachTagAction(
  contactId: string,
  tagId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { id: ownerId } = await getCurrentUser();
    await TagService.detach(contactId, tagId, ownerId);
    revalidatePath(`/contacts/${contactId}`);
    return { ok: true };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error('detachTagAction error:', e);
    return { ok: false, error: '删除失败' };
  }
}

export async function deleteContactAction(id: string) {
  const { id: ownerId } = await getCurrentUser();
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await ContactService.remove(id, ownerId, prismaDb);
  revalidatePath('/contacts');
  redirect('/contacts');
}

