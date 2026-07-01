'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { EventService, type EventInput } from '@/server/services/event';
import { DEFAULT_EVENT_TYPE } from '@/lib/event-type';
import { ValidationError } from '@/lib/errors';
import { ZodError } from 'zod';
import type { ActionResult } from '@/lib/action';
import { getCurrentUser } from '@/lib/auth/session';

export async function createEventAction(
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    const input = parseEventInput(fd);
    const followupTitle = ((fd.get('followupTitle') as string) ?? '').trim();
    const followupOffset = Number(fd.get('followupOffsetMinutes') ?? 0);
    const firstContactId = input.contactId ?? undefined;
    const db = (await import('@/lib/prisma')).prisma;
    const e = followupTitle && followupOffset > 0
      ? await EventService.createWithFollowup(
          input,
          { title: followupTitle, offsetMinutes: followupOffset, contactId: firstContactId },
          ownerId,
          db,
        )
      : await EventService.create(input, ownerId, db);
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
    const { id: ownerId } = await getCurrentUser();
    const input = parseEventInput(fd);
    const db = (await import('@/lib/prisma')).prisma;
    await EventService.update(id, input, ownerId, db);
    revalidatePath('/calendar');
    revalidatePath('/today');
    revalidatePath('/actions');
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
  const { id: ownerId } = await getCurrentUser();
  const db = (await import('@/lib/prisma')).prisma;
  await EventService.remove(id, ownerId, db);
  revalidatePath('/calendar');
  revalidatePath('/today');
  revalidatePath('/actions');
  redirect('/calendar');
}

function parseEventInput(fd: FormData): EventInput {
  const startAtRaw = String(fd.get('startAt') ?? '');
  if (!startAtRaw) {
    throw new ValidationError('请填写开始时间');
  }
  const startAt = new Date(startAtRaw);
  if (isNaN(startAt.getTime())) {
    throw new ValidationError('开始时间格式无效');
  }

  const endAtRaw = fd.get('endAt') ? String(fd.get('endAt')) : null;
  let endAt: Date | null = null;
  if (endAtRaw) {
    endAt = new Date(endAtRaw);
    if (isNaN(endAt.getTime())) {
      endAt = null; // Silently ignore invalid end time
    }
  }

  return {
    title: String(fd.get('title') ?? ''),
    type: ((fd.get('type') as string) || DEFAULT_EVENT_TYPE) as EventInput['type'],
    startAt,
    endAt,
    location: (fd.get('location') as string) || null,
    notes: (fd.get('notes') as string) || null,
    contactId: (fd.get('contactId') as string) || null,
  };
}
