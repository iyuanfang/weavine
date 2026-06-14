import Database from 'better-sqlite3';
import { prisma } from '@/lib/prisma';
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

  const where: Record<string, unknown> = {};

  if (idsFromFts.length > 0) {
    where.id = { in: idsFromFts };
  }

  if (parsed.city) {
    where.city = parsed.city;
  }

  let candidates = await prisma.contact.findMany({
    where: where as any,
    include: { tags: { include: { tag: true } } },
    orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  });

  if (candidates.length === 0 && parsed.text) {
    candidates = await prisma.contact.findMany({
      where: {
        OR: [
          ...(parsed.text ? [{ name: { contains: parsed.text } }] : []),
          ...(parsed.text ? [{ company: { contains: parsed.text } }] : []),
          ...(parsed.text ? [{ notes: { contains: parsed.text } }] : []),
        ],
      },
      include: { tags: { include: { tag: true } } },
      orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });
  }

  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    city: c.city,
    tags: c.tags,
  }));
}
