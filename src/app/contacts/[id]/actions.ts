'use server';

import { revalidatePath } from 'next/cache';
import { InteractionService } from '@/server/services/interaction';
import type { ActionResult } from '@/lib/action';
import { ValidationError } from '@/lib/errors';
import { getCurrentUser } from '@/lib/auth/session';

export async function logInteractionAction(
  contactId: string,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    await InteractionService.log({
      contactId,
      occurredAt: new Date(String(fd.get('occurredAt'))),
      channel: (fd.get('channel') as string) || null,
      summary: String(fd.get('summary') ?? ''),
    }, ownerId);
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/today');
    return { ok: true, data: null };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    return { ok: false, error: '记录失败' };
  }
}

export async function deleteInteractionAction(
  contactId: string,
  id: string,
): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    await InteractionService.remove(id, ownerId);
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/today');
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: '删除失败' };
  }
}

export async function updateInteractionAction(
  id: string,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const { id: ownerId } = await getCurrentUser();
    await InteractionService.update(id, {
      occurredAt: new Date(String(fd.get('occurredAt'))),
      channel: (fd.get('channel') as string) || null,
      summary: String(fd.get('summary') ?? ''),
    }, ownerId);
    const prismaDb = (await import('@/lib/prisma')).prisma;
    const interaction = await prismaDb.interaction.findUnique({
      where: { id },
      select: { contactId: true },
    });
    if (interaction?.contactId) {
      revalidatePath(`/contacts/${interaction.contactId}`);
    }
    revalidatePath('/today');
    revalidatePath(`/interactions/${id}`);
    return { ok: true, data: null };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    return { ok: false, error: '保存失败' };
  }
}
