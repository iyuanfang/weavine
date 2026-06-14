'use server';

import { revalidatePath } from 'next/cache';
import { TagService } from '@/server/services/tag';
import { tagColor } from '@/lib/tag-color';

export async function createTag(fd: FormData) {
  const name = String(fd.get('name'));
  await TagService.create({
    name,
    color: tagColor(name).bg,
  });
  revalidatePath('/tags');
  revalidatePath('/contacts');
}

export async function renameTag(id: string, fd: FormData) {
  await TagService.rename(id, String(fd.get('name')));
  revalidatePath('/tags');
}

export async function deleteTag(id: string) {
  await TagService.remove(id);
  revalidatePath('/tags');
  revalidatePath('/contacts');
}
