import { NextRequest } from 'next/server';
import { ContactService } from '@/server/services/contact';
import { getCurrentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { id: ownerId } = await getCurrentUser();
  const contacts = await ContactService.listLight(ownerId);
  return Response.json({ contacts });
}