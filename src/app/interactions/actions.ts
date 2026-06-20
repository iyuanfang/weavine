'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { InteractionService } from '@/server/services/interaction';
import type { ActionResult } from '@/lib/action';
import { ValidationError } from '@/lib/errors';
import { getCurrentUser } from '@/lib/auth/session';

export async function deleteInteractionFromDetailAction(
  id: string,
): Promise<ActionResult> {
  let contactId: string | null = null;
  try {
    const { id: ownerId } = await getCurrentUser();
    const i = await InteractionService.get(id, ownerId);
    contactId = i.contactId;
    await InteractionService.remove(id, ownerId);
    if (contactId) revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/today');
  } catch {
    return { ok: false, error: '删除失败' };
  }
  redirect(contactId ? `/contacts/${contactId}` : '/today');
}
