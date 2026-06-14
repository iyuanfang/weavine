'use server';

import { revalidatePath } from 'next/cache';
import { InboxService } from '@/server/services/inbox';

export async function markReadAction(id: string) {
  await InboxService.markRead(id);
  revalidatePath('/inbox');
}

export async function markAllReadAction() {
  await InboxService.markAllRead();
  revalidatePath('/inbox');
}

export async function deleteInboxItemAction(id: string) {
  await InboxService.remove(id);
  revalidatePath('/inbox');
}
