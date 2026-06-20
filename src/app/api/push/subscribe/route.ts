import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { id: ownerId } = await getCurrentUser();
  const body = await req.json();
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return new Response('invalid subscription', { status: 400 });
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      ownerId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    update: {
      ownerId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
  });
  return Response.json({ ok: true });
}
