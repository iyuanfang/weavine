import type { ContactInput } from '@/server/services/contact';

export function parseContactInput(fd: FormData): ContactInput {
  const intervalRaw = String(fd.get('reminderIntervalDays') ?? '').trim();
  const interval = intervalRaw ? Number(intervalRaw) : null;

  return {
    nickname: String(fd.get('nickname') ?? '').trim(),
    name: (fd.get('name') as string)?.trim() || null,
    company: (fd.get('company') as string) || null,
    title: (fd.get('title') as string) || null,
    city: (fd.get('city') as string) || null,
    email: (fd.get('email') as string) || null,
    phone: (fd.get('phone') as string) || null,
    wechat: (fd.get('wechat') as string) || null,
    notes: (fd.get('notes') as string) || null,
    importance: String(fd.get('importance') ?? 'normal') as ContactInput['importance'],
    reminderEnabled: fd.get('reminderEnabled') === 'on',
    reminderIntervalDays: Number.isFinite(interval) ? interval : null,
  } as ContactInput;
}
