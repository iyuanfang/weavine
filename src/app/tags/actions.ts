'use server';

import { revalidatePath } from 'next/cache';
import { TagService } from '@/server/services/tag';

const TAG_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#d946ef', '#22c55e', '#eab308', '#64748b',
];

function randomTagColor(): string {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

export async function createTag(fd: FormData) {
  await TagService.create({
    name: String(fd.get('name')),
    color: (fd.get('color') as string) || randomTagColor(),
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
