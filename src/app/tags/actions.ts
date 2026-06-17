'use server';

import { revalidatePath } from 'next/cache';
import { TagService } from '@/server/services/tag';
import { tagColor } from '@/lib/tag-color';
import { ValidationError } from '@/lib/errors';
import type { ActionResult } from '@/lib/action';

export async function createTag(fd: FormData): Promise<ActionResult> {
  try {
    const name = String(fd.get('name'));
    await TagService.create({
      name,
      color: tagColor(name).bg,
    });
    revalidatePath('/tags');
    revalidatePath('/contacts');
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error('createTag error:', e);
    return { ok: false, error: '创建失败' };
  }
}

export async function renameTag(id: string, fd: FormData): Promise<ActionResult> {
  try {
    await TagService.rename(id, String(fd.get('name')));
    revalidatePath('/tags');
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error('renameTag error:', e);
    return { ok: false, error: '改名失败' };
  }
}

export async function deleteTag(id: string): Promise<ActionResult> {
  try {
    await TagService.remove(id);
    revalidatePath('/tags');
    revalidatePath('/contacts');
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error('deleteTag error:', e);
    return { ok: false, error: '删除失败' };
  }
}
