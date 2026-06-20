import { TagService } from '@/server/services/tag';
import { getCurrentUser } from '@/lib/auth/session';
import { TagsPageClient } from './tags-client';

export default async function TagsPage() {
  const { id: ownerId } = await getCurrentUser();
  const tags = await TagService.list(ownerId);

  return (
    <TagsPageClient
      tags={tags.map((t) => ({
        ...t,
        createdAt: t.createdAt,
      }))}
    />
  );
}
