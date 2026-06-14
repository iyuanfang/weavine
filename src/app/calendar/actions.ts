'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { EventService, type EventInput } from '@/server/services/event';
import { ValidationError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action';

export async function createEventAction(
  fd: FormData,
): Promise<ActionResult> {
  try {
    const input = parseEventInput(fd);
    const db = (await import('@/lib/prisma')).prisma;
    const e = await EventService.create(input, db);
    revalidatePath('/calendar');
    redirect(`/events/${e.id}`);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    return { ok: false, error: '创建失败' };
  }
}

export async function updateEventAction(
  id: string,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const input = parseEventInput(fd);
    const db = (await import('@/lib/prisma')).prisma;
    await EventService.update(id, input, db);
    revalidatePath('/calendar');
    revalidatePath(`/events/${id}`);
    redirect(`/events/${id}`);
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
    return { ok: false, error: '更新失败' };
  }
}

export async function deleteEventAction(id: string) {
  const db = (await import('@/lib/prisma')).prisma;
  await EventService.remove(id, db);
  revalidatePath('/calendar');
  redirect('/calendar');
}

function parseEventInput(fd: FormData): EventInput {
  const tagIds = fd.getAll('attendeeId').map(String).filter(Boolean);
  return {
    title: String(fd.get('title') ?? ''),
    type: ((fd.get('type') as string) || 'meeting') as EventInput['type'],
    startAt: new Date(String(fd.get('startAt'))),
    endAt: fd.get('endAt') ? new Date(String(fd.get('endAt'))) : null,
    location: (fd.get('location') as string) || null,
    notes: (fd.get('notes') as string) || null,
    attendeeIds: tagIds,
  };
}
