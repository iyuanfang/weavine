import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let _db: PrismaClient | null = null;
let _dir: string | null = null;

export function testDb(): PrismaClient {
  if (_db) return _db;

  _dir = mkdtempSync(join(tmpdir(), 'prm-test-'));
  const url = `file:${join(_dir, 'test.db')}`;
  process.env.DATABASE_URL = url;

  execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });

  _db = new PrismaClient({
    datasources: { db: { url } },
  });
  return _db;
}

export function closeTestDb(): void {
  _db?.$disconnect().catch(() => {});
  if (_dir) {
    rmSync(_dir, { recursive: true, force: true });
  }
  _db = null;
  _dir = null;
}
