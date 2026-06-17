'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { EventService, type EventInput } from '@/server/services/event';
import { ValidationError } from '@/lib/errors';
import { ZodError } from 'zod';
import type { ActionResult } from '@/lib/action';

export async function createEventAction(
  fd: FormData,
): Promise<ActionResult> {
  try {
    const input = parseEventInput(fd);
    const followupTitle = ((fd.get('followupTitle') as string) ?? '').trim();
    const followupOffset = Number(fd.get('followupOffsetMinutes') ?? 0);
    const firstAttendee = input.attendeeIds[0];
    const db = (await import('@/lib/prisma')).prisma;
    const e = followupTitle && followupOffset > 0
      ? await EventService.createWithFollowup(
          input,
          { title: followupTitle, offsetMinutes: followupOffset, contactId: firstAttendee },
          db,
        )
      : await EventService.create(input, db);
    revalidatePath('/calendar');
    revalidatePath('/today');
    revalidatePath('/actions');
    redirect(`/events/${e.id}`);
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' };
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
    if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' };
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
