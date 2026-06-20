'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ActionService, type ActionStatus } from '@/server/services/action';
import { ValidationError } from '@/lib/errors';
import { ZodError } from 'zod';
import type { ActionResult } from '@/lib/action';
import { getCurrentUser } from '@/lib/auth/session';

export async function createAction(fd: FormData): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    const dueRaw = fd.get('dueAt') as string;
    const input = {
      title: String(fd.get('title') ?? ''),
      description: (fd.get('description') as string) || null,
      status: (fd.get('status') as ActionStatus) || 'inbox',
      priority: (Number(fd.get('priority') ?? 0) as 0 | 1 | 2),
      category: (fd.get('category') as string) || null,
      dueAt: dueRaw ? new Date(dueRaw) : null,
      contactId: (fd.get('contactId') as string) || null,
      eventId: (fd.get('eventId') as string) || null,
    };
    const prismaDb = (await import('@/lib/prisma')).prisma;
    const a = await ActionService.create(input, ownerId, prismaDb);
    revalidatePath('/today');
    revalidatePath('/actions');
    redirect(`/actions/${a.id}`);
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' };
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    console.error('createAction error', e);
    return { ok: false, error: '创建失败' };
  }
}

export async function createActionQuick(input: {
  title: string;
  contactId?: string | null;
  dueAt?: string | null;
  status?: ActionStatus;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const { id: ownerId } = await getCurrentUser();
    if (!input.title.trim()) return { ok: false, error: '标题必填' };
    const prismaDb = (await import('@/lib/prisma')).prisma;
    const a = await ActionService.create(
      {
        title: input.title.trim(),
        status: input.status ?? 'inbox',
        contactId: input.contactId || null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        priority: 0,
      },
      ownerId,
      prismaDb,
    );
    revalidatePath('/today');
    revalidatePath('/actions');
    return { ok: true, id: a.id };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' };
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error('createActionQuick error', e);
    return { ok: false, error: '创建失败' };
  }
}

export async function transitionAction(id: string, to: ActionStatus) {
  const { id: ownerId } = await getCurrentUser();
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await ActionService.transition(id, to, ownerId, prismaDb);
  revalidatePath('/today');
  revalidatePath('/actions');
}

export async function completeActionQuick(id: string) {
  try {
    const { id: ownerId } = await getCurrentUser();
    const prismaDb = (await import('@/lib/prisma')).prisma;
    await ActionService.transition(id, 'done', ownerId, prismaDb);
    revalidatePath('/today');
    revalidatePath('/actions');
    return { ok: true };
  } catch (e) {
    console.error('completeActionQuick error', e);
    return { ok: false, error: '操作失败' };
  }
}

export async function updateAction(id: string, fd: FormData): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    const dueRaw = fd.get('dueAt') as string;
    const eventIdRaw = fd.get('eventId');
    const input = {
      title: String(fd.get('title') ?? ''),
      description: (fd.get('description') as string) || null,
      status: (fd.get('status') as ActionStatus) || 'inbox',
      priority: (Number(fd.get('priority') ?? 0) as 0 | 1 | 2),
      category: (fd.get('category') as string) || null,
      dueAt: dueRaw ? new Date(dueRaw) : null,
      contactId: (fd.get('contactId') as string) || null,
      ...(eventIdRaw !== null ? { eventId: (eventIdRaw as string) || null } : {}),
    };
    const prismaDb = (await import('@/lib/prisma')).prisma;
    await ActionService.update(id, input, ownerId, prismaDb);
    revalidatePath(`/actions/${id}`);
    revalidatePath('/today');
    revalidatePath('/actions');
    redirect(`/actions/${id}`);
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' };
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    console.error('updateAction error', e);
    return { ok: false, error: '更新失败' };
  }
}

export async function deleteAction(id: string) {
  const { id: ownerId } = await getCurrentUser();
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await ActionService.remove(id, ownerId, prismaDb);
  revalidatePath('/today');
  revalidatePath('/actions');
  revalidatePath(`/actions/${id}`);
  redirect('/actions');
}
