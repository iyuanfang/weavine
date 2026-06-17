'use server';

import { revalidatePath } from 'next/cache';
import { ContactService } from '@/server/services/contact';
import { InteractionService } from '@/server/services/interaction';
import { ActionService } from '@/server/services/action';
import { EventService } from '@/server/services/event';
import type { EventInput } from '@/server/services/event';

export async function quickLogAction(
  fd: FormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const type = fd.get('type') as string;
    const contactId = fd.get('contactId') as string;
    const newContactName = (fd.get('newContactName') as string) || '';
    const db = (await import('@/lib/prisma')).prisma;
    const cid =
      contactId === '__new__'
        ? (await ContactService.create({ name: newContactName }, db)).id
        : contactId || '';

    if (type === 'interaction') {
      const summary = (fd.get('summary') as string)?.trim();
      const channel = (fd.get('channel') as string) || null;
      if (!cid || !summary)
        return { ok: false, error: '请选择联系人并填写内容' };

      await InteractionService.log(
        { contactId: cid, summary, channel, occurredAt: new Date() },
        db,
      );
    } else if (type === 'action') {
      const title = (fd.get('title') as string)?.trim();
      if (!title) return { ok: false, error: '请填写待办标题' };

      await ActionService.create(
        {
          title,
          contactId: cid || null,
          priority: Number(fd.get('priority') ?? 0),
          dueAt: fd.get('dueAt')
            ? new Date(fd.get('dueAt') as string)
            : null,
          status: 'inbox',
        },
        db,
      );
    } else if (type === 'event') {
      const title = (fd.get('title') as string)?.trim();
      if (!title) return { ok: false, error: '请填写日程标题' };

      const startAt = fd.get('startAt') as string;
      if (!startAt) return { ok: false, error: '请选择开始时间' };

      const input: EventInput = {
        title,
        type: 'meeting',
        startAt: new Date(startAt),
        endAt: null,
        location: (fd.get('location') as string) || null,
        notes: null,
        attendeeIds: cid ? [cid] : [],
      };

      await EventService.create(input, db);
    }

    if (contactId === '__new__') {
      revalidatePath('/contacts');
    }
    revalidatePath('/today');
    revalidatePath('/actions');
    revalidatePath('/calendar');
    return { ok: true };
  } catch (e) {
    console.error('quickLog error', e);
    return { ok: false, error: '创建失败' };
  }
}
