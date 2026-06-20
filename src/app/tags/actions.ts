'use server';

import { revalidatePath } from 'next/cache';
import { isRedirectError } from 'next/dist/client/components/redirect';
import { Prisma } from '@prisma/client';
import { TagService } from '@/server/services/tag';
import { ValidationError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action';
import { getCurrentUser } from '@/lib/auth/session';

const TAG_PALETTE = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#6b7280'];

function pickColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

export async function createTag(
  _prev: unknown,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return { ok: false, error: '标签名不能为空' };
    await TagService.create({ name, color: pickColor(name) }, ownerId);
    revalidatePath('/tags');
    revalidatePath('/contacts');
    return { ok: true, data: undefined };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: '已存在同名标签' };
    }
    console.error('createTag error:', e);
    return { ok: false, error: '创建失败' };
  }
}

export async function renameTag(
  id: string,
  _prev: unknown,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return { ok: false, error: '标签名不能为空' };
    await TagService.rename(id, name, ownerId);
    revalidatePath('/tags');
    return { ok: true, data: undefined };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: '已存在同名标签' };
    }
    console.error('renameTag error:', e);
    return { ok: false, error: '改名失败' };
  }
}

export async function deleteTag(id: string): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    await TagService.remove(id, ownerId);
    revalidatePath('/tags');
    revalidatePath('/contacts');
    return { ok: true, data: undefined };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error('deleteTag error:', e);
    return { ok: false, error: '删除失败' };
  }
}
