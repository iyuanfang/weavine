'use server';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { revalidatePath } from 'next/cache';

const PATH = join(process.cwd(), 'prisma', 'settings.json');

export type Settings = {
  reminderOffsets: number[];
  staleDays: number[];
  accent: string;
};

const DEFAULTS: Settings = {
  reminderOffsets: [60, 1440],
  staleDays: [90, 180, 365],
  accent: '#2563eb',
};

export async function readSettings(): Promise<Settings> {
  try {
    if (existsSync(PATH)) {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(PATH, 'utf8')) };
    }
    return DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export async function writeSettings(fd: FormData) {
  const next: Settings = {
    reminderOffsets: String(fd.get('reminderOffsets') ?? '')
      .split(',')
      .map(Number)
      .filter((n) => !isNaN(n)),
    staleDays: String(fd.get('staleDays') ?? '')
      .split(',')
      .map(Number)
      .filter((n) => !isNaN(n)),
    accent: String(fd.get('accent') ?? '#2563eb'),
  };
  writeFileSync(PATH, JSON.stringify(next, null, 2));
  revalidatePath('/settings');
}
