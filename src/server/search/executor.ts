import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { Parsed } from './parser';

export type ContactHit = {
  type: 'contact';
  id: string;
  nickname: string;
  name: string | null;
  company: string | null;
  city: string | null;
  tags: { tag: { id: string; name: string; color: string | null } }[];
};

export type ActionHit = {
  type: 'action';
  id: string;
  title: string;
  status: string;
  priority: number;
  dueAt: string | null;
  contact: { id: string; nickname: string; name: string | null } | null;
};

export type EventHit = {
  type: 'event';
  id: string;
  title: string;
  type_: string;
  startAt: string;
  location: string | null;
  contact: { id: string; nickname: string; name: string | null } | null;
};

export type Hit = ContactHit | ActionHit | EventHit;

export async function executeSearch(
  ownerId: string,
  parsed: Parsed,
): Promise<Hit[]> {
  const hits: Hit[] = [];
  const text = parsed.text?.trim() ?? '';

  let contactIds: string[] = [];
  let actionIds: string[] = [];
  let eventIds: string[] = [];

  if (text) {
    const [cLike, aLike, eLike] = await Promise.all([
      prisma.contact.findMany({
        where: {
          ownerId,
          OR: [
            { nickname: { contains: text, mode: 'insensitive' } },
            { name: { contains: text, mode: 'insensitive' } },
            { company: { contains: text, mode: 'insensitive' } },
            { notes: { contains: text, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 200,
      }),
      prisma.action.findMany({
        where: {
          ownerId,
          OR: [
            { title: { contains: text, mode: 'insensitive' } },
            { description: { contains: text, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 200,
      }),
      prisma.event.findMany({
        where: {
          ownerId,
          OR: [
            { title: { contains: text, mode: 'insensitive' } },
            { notes: { contains: text, mode: 'insensitive' } },
            { location: { contains: text, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 200,
      }),
    ]);
    contactIds = cLike.map((r) => r.id);
    actionIds = aLike.map((r) => r.id);
    eventIds = eLike.map((r) => r.id);
  }

  if (parsed.city) {
    const cityHits = await prisma.contact.findMany({
      where: { ownerId, city: { contains: parsed.city, mode: 'insensitive' } },
      select: { id: true },
      take: 200,
    });
    contactIds = [...new Set([...contactIds, ...cityHits.map((c) => c.id)])];
  }

  const [contacts, actions, events] = await Promise.all([
    contactIds.length > 0 || parsed.city
      ? prisma.contact.findMany({
          where: {
            ownerId,
            ...(contactIds.length > 0 ? { id: { in: contactIds } } : {}),
            ...(parsed.city ? { city: { contains: parsed.city, mode: 'insensitive' } } : {}),
          } as Prisma.ContactWhereInput,
          include: { tags: { include: { tag: true } } },
          orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
          take: 200,
        })
      : Promise.resolve([]),
    actionIds.length > 0
      ? prisma.action.findMany({
          where: { ownerId, id: { in: actionIds } },
          include: { contact: { select: { id: true, nickname: true, name: true } } },
          orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { priority: 'desc' }],
          take: 100,
        })
      : Promise.resolve([]),
    eventIds.length > 0
      ? prisma.event.findMany({
          where: { ownerId, id: { in: eventIds } },
          include: { contact: { select: { id: true, nickname: true, name: true } } },
          orderBy: { startAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  for (const c of contacts) {
    hits.push({
      type: 'contact',
      id: c.id,
      nickname: c.nickname,
      name: c.name,
      company: c.company,
      city: c.city,
      tags: c.tags,
    });
  }
  for (const a of actions) {
    hits.push({
      type: 'action',
      id: a.id,
      title: a.title,
      status: a.status,
      priority: a.priority,
      dueAt: a.dueAt?.toISOString() ?? null,
      contact: a.contact
        ? { id: a.contact.id, nickname: a.contact.nickname, name: a.contact.name }
        : null,
    });
  }
  for (const e of events) {
    hits.push({
      type: 'event',
      id: e.id,
      title: e.title,
      type_: e.type,
      startAt: e.startAt.toISOString(),
      location: e.location,
      contact: e.contact,
    });
  }

  return hits;
}
