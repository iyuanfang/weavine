import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return new Response('invalid subscription', { status: 400 });
  }

  const url = (process.env.DATABASE_URL ?? 'file:./prisma/dev.db').replace(
    /^file:/,
    '',
  );
  const db = new Database(url);
  try {
    db.prepare(
      'INSERT OR REPLACE INTO push_subscription(id, endpoint, p256dh, auth, createdAt) VALUES (?,?,?,?,?)',
    ).run(randomUUID(), sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
  } finally {
    db.close();
  }
  return Response.json({ ok: true });
}
