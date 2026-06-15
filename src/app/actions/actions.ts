'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ActionService } from '@/server/services/action';
import { ValidationError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action';
import type { ActionStatus } from '@/server/services/action';

export async function createAction(fd: FormData): Promise<ActionResult> {
  try {
    const dueRaw = fd.get('dueAt') as string;
    const input = {
      title: String(fd.get('title') ?? ''),
      description: (fd.get('description') as string) || null,
      status: (fd.get('status') as ActionStatus) || 'inbox',
      priority: Number(fd.get('priority') ?? 0),
      category: (fd.get('category') as string) || null,
      dueAt: dueRaw ? new Date(dueRaw) : null,
      contactId: (fd.get('contactId') as string) || null,
      waitingOnId: (fd.get('waitingOnId') as string) || null,
      eventId: (fd.get('eventId') as string) || null,
    };
    const prismaDb = (await import('@/lib/prisma')).prisma;
    const a = await ActionService.create(input, prismaDb);
    revalidatePath('/today');
    revalidatePath('/actions');
    redirect(`/actions/${a.id}`);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    console.error('createAction error', e);
    return { ok: false, error: '创建失败' };
  }
}

export async function transitionAction(id: string, to: ActionStatus) {
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await ActionService.transition(id, to, prismaDb);
  revalidatePath('/today');
  revalidatePath('/actions');
}

export async function deleteAction(id: string) {
  const prismaDb = (await import('@/lib/prisma')).prisma;
  await ActionService.remove(id, prismaDb);
  revalidatePath('/today');
  revalidatePath('/actions');
}
