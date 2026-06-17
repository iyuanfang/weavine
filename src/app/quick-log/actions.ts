'use server';

import { revalidatePath } from 'next/cache';
import { InteractionService } from '@/server/services/interaction';
import { ActionService } from '@/server/services/action';
import { EventService } from '@/server/services/event';
import type { EventInput } from '@/server/services/event';

export async function quickLogAction(
  fd: FormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const type = fd.get('type') as string;

    if (type === 'interaction') {
      const contactId = fd.get('contactId') as string;
      const summary = (fd.get('summary') as string)?.trim();
      const channel = (fd.get('channel') as string) || null;
      if (!contactId || !summary)
        return { ok: false, error: '请选择联系人并填写内容' };

      const db = (await import('@/lib/prisma')).prisma;
      await InteractionService.log(
        { contactId, summary, channel, occurredAt: new Date() },
        db,
      );
    } else if (type === 'action') {
      const title = (fd.get('title') as string)?.trim();
      if (!title) return { ok: false, error: '请填写待办标题' };

      const db = (await import('@/lib/prisma')).prisma;
      await ActionService.create(
        {
          title,
          contactId: (fd.get('contactId') as string) || null,
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

      const attendeeId = fd.get('contactId') as string;
      const input: EventInput = {
        title,
        type: 'meeting',
        startAt: new Date(startAt),
        endAt: null,
        location: (fd.get('location') as string) || null,
        notes: null,
        attendeeIds: attendeeId ? [attendeeId] : [],
      };

      const db = (await import('@/lib/prisma')).prisma;
      await EventService.create(input, db);
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
