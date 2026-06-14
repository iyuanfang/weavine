import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { ReminderService } from './reminder';

beforeAll(() => {
  testDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe('ReminderService.scheduleOffsets', () => {
  it('returns trigger timestamps before start', () => {
    const triggers = ReminderService.scheduleOffsets(
      '2026-07-01T10:00:00Z',
      [60, 1440],
      new Date('2025-01-01T00:00:00Z'),
    );
    expect(triggers).toHaveLength(2);
    const mins = triggers.map((t) => t.triggerAt.getTime());
    expect(mins[0]).toBeLessThan(mins[1]);
  });

  it('skips past offsets when now is beyond trigger time', () => {
    const triggers = ReminderService.scheduleOffsets(
      '2020-01-01T00:00:00Z',
      [60, 1440],
      new Date('2020-02-01T00:00:00Z'),
    );
    expect(triggers).toHaveLength(0);
  });
});
