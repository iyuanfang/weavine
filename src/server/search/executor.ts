import Database from 'better-sqlite3';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { Parsed } from './parser';

export type Hit = {
  id: string;
  name: string;
  company: string | null;
  city: string | null;
  tags: { tag: { id: string; name: string; color: string | null } }[];
};

function dbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  return url.replace(/^file:/, '');
}

function ftsQuery(text: string): string {
  if (!text) return '';
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
}

export async function executeSearch(parsed: Parsed): Promise<Hit[]> {
  const q = ftsQuery(parsed.text);
  const idsFromFts: string[] = [];

  if (q) {
    const db = new Database(dbPath(), { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT c.id
           FROM contact_fts
           JOIN Contact c ON c.rowid = contact_fts.rowid
           WHERE contact_fts MATCH ?
           LIMIT 200`,
        )
        .all(q) as { id: string }[];
      idsFromFts.push(...rows.map((r) => r.id));
    } finally {
      db.close();
    }
  }

  // Also search via LIKE (catches notes content, Chinese tokens, etc.)
  const likeIds: string[] = [];
  if (parsed.text) {
    const like = await prisma.contact.findMany({
      where: {
        OR: [
          { name: { contains: parsed.text } },
          { company: { contains: parsed.text } },
          { notes: { contains: parsed.text } },
        ],
      },
      select: { id: true },
    });
    likeIds.push(...like.map((r) => r.id));
  }

  // Combine FTS5 + LIKE results
  const allIds = [...new Set([...idsFromFts, ...likeIds])];
  const where: Record<string, unknown> = {};

  if (allIds.length > 0) {
    where.id = { in: allIds };
  }

  if (parsed.city) {
    where.city = parsed.city;
  }

  const candidates = await prisma.contact.findMany({
    where: where as Prisma.ContactWhereInput,
    include: { tags: { include: { tag: true } } },
    orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  });

  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    city: c.city,
    tags: c.tags,
  }));
}
