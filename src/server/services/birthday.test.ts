import { describe, it, expect } from 'vitest';
import { BirthdayService } from './birthday';

describe('BirthdayService.upcoming', () => {
  it('finds same-day and next-day birthdays within window', () => {
    const contacts = [
      { id: '1', name: '今天', birthdayMonth: 6, birthdayDay: 14 },
      { id: '2', name: '明天', birthdayMonth: 6, birthdayDay: 15 },
      { id: '3', name: '下个月', birthdayMonth: 7, birthdayDay: 1 },
    ];
    const r = BirthdayService.upcoming(
      contacts,
      new Date('2026-06-14T08:00:00'),
       7 * 24 * 60 * 60 * 1000,
    );
    expect(r.map((x) => x.id)).toEqual(['1', '2']);
  });

  it('returns empty for no matching birthdays', () => {
    const r = BirthdayService.upcoming(
      [{ id: '1', name: 'A', birthdayMonth: 12, birthdayDay: 25 }],
      new Date('2026-01-01'),
      1000,
    );
    expect(r).toHaveLength(0);
  });

  it('skips contacts without birthday fields', () => {
    const r = BirthdayService.upcoming(
      [{ id: '1', name: 'A', birthdayMonth: null, birthdayDay: null }],
      new Date('2026-01-01'),
      86400 * 1000,
    );
    expect(r).toHaveLength(0);
  });
});
