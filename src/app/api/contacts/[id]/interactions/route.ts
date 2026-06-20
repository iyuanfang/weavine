import { NextRequest } from 'next/server';
import { InteractionService } from '@/server/services/interaction';
import { getCurrentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id: ownerId } = await getCurrentUser();
  const fd = await req.formData();
  const occurredAt = String(fd.get('occurredAt') ?? '');
  const channel = String(fd.get('channel') ?? '') || null;
  const summary = String(fd.get('summary') ?? '').trim();
  if (!occurredAt || !summary) {
    return new Response('missing fields', { status: 400 });
  }
  await InteractionService.log({
    contactId: params.id,
    occurredAt: new Date(occurredAt),
    channel,
    summary,
  }, ownerId);
  return Response.json({ ok: true });
}
