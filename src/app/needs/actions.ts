'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NeedService } from '@/server/services/need';
import type { NeedStatus } from '@/server/services/need';
import { NeedCreateInput } from '@/server/services/need';
import { ValidationError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action';

function parse(fd: FormData) {
  return {
    title: String(fd.get('title') ?? ''),
    description: (fd.get('description') as string) || null,
    category: (fd.get('category') ?? '其他') as NeedCreateInput['category'],
    priority: Number(fd.get('priority') ?? 0),
    contactId: (fd.get('contactId') as string) || null,
  };
}

export async function createNeed(
  fd: FormData,
): Promise<ActionResult> {
  try {
    const prismaDb = (await import('@/lib/prisma')).prisma;
    const n = await NeedService.create(parse(fd), prismaDb);
    revalidatePath('/needs');
    redirect(`/needs/${n.id}`);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    return { ok: false, error: '创建失败' };
  }
}

export async function updateNeed(
  id: string,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const prismaDb = (await import('@/lib/prisma')).prisma;
    await NeedService.update(id, parse(fd), prismaDb);
    revalidatePath('/needs');
    revalidatePath(`/needs/${id}`);
    redirect(`/needs/${id}`);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    return { ok: false, error: '更新失败' };
  }
}

export async function transitionNeed(id: string, to: string) {
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await NeedService.transition(id, to as NeedStatus, prismaDb);
  revalidatePath('/needs');
  revalidatePath(`/needs/${id}`);
}

export async function moveNeed(id: string, to: string) {
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await NeedService.transition(id, to as NeedStatus, prismaDb);
  revalidatePath('/needs');
}

export async function assignNeed(needId: string, fd: FormData) {
  const prismaDb = (await import('@/lib/prisma')).prisma;
  const contactId = String(fd.get('contactId') ?? '');
  if (contactId) {
    await NeedService.assignContact(needId, contactId, prismaDb);
  }
  revalidatePath('/needs');
  revalidatePath(`/needs/${needId}`);
}

export async function deleteNeed(id: string) {
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await NeedService.remove(id, prismaDb);
  revalidatePath('/needs');
  redirect('/needs');
}
