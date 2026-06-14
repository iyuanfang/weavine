'use server';

import { revalidatePath } from 'next/cache';
import { TagService } from '@/server/services/tag';

export async function createTag(fd: FormData) {
  await TagService.create({
    name: String(fd.get('name')),
    color: (fd.get('color') as string) || undefined,
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
