import { NextRequest } from 'next/server';
import { SearchService } from '@/server/search/search-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (!q.trim()) {
    return Response.json({ hits: [], parsed: { text: '', chips: [], city: null, category: null } });
  }
  const r = await SearchService.run(q);
  return Response.json(r);
}
