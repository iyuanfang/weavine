import { describe, expect, it } from 'vitest';
import { parseContactInput } from './input';

describe('parseContactInput', () => {
  it('parses contact importance and reminder preferences', () => {
    const fd = new FormData();
    fd.set('nickname', 'Alice');
    fd.set('importance', 'important');
    fd.set('reminderEnabled', 'on');
    fd.set('reminderIntervalDays', '21');

    expect(parseContactInput(fd)).toMatchObject({
      nickname: 'Alice',
      importance: 'important',
      reminderEnabled: true,
      reminderIntervalDays: 21,
    });
  });

  it('defaults reminders to disabled when the checkbox is not submitted', () => {
    const fd = new FormData();
    fd.set('nickname', 'Bob');
    fd.set('importance', 'low');

    expect(parseContactInput(fd)).toMatchObject({
      importance: 'low',
      reminderEnabled: false,
      reminderIntervalDays: null,
    });
  });

  it('ignores blank reminder intervals', () => {
    const fd = new FormData();
    fd.set('nickname', 'Carol');
    fd.set('importance', 'normal');
    fd.set('reminderEnabled', 'on');
    fd.set('reminderIntervalDays', '');

    expect(parseContactInput(fd)).toMatchObject({
      reminderEnabled: true,
      reminderIntervalDays: null,
    });
  });
});
