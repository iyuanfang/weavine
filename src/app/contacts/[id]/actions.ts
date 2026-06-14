'use server';

import { revalidatePath } from 'next/cache';
import { InteractionService } from '@/server/services/interaction';
import type { ActionResult } from '@/lib/action';
import { ValidationError } from '@/lib/errors';

export async function logInteractionAction(
  contactId: string,
  fd: FormData,
): Promise<ActionResult> {
  try {
    await InteractionService.log({
      contactId,
      occurredAt: new Date(String(fd.get('occurredAt'))),
      channel: (fd.get('channel') as string) || null,
      summary: String(fd.get('summary') ?? ''),
    });
    revalidatePath(`/contacts/${contactId}`);
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
    await InteractionService.remove(id);
    revalidatePath(`/contacts/${contactId}`);
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: '删除失败' };
  }
}
