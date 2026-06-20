import { NextRequest } from 'next/server';
import { SearchService } from '@/server/search/search-service';
import { getCurrentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { id: ownerId } = await getCurrentUser();
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (!q.trim()) {
    return Response.json({ hits: [], parsed: { text: '', chips: [], city: null, category: null } });
  }
  const r = await SearchService.run(ownerId, q);
  return Response.json(r);
}
