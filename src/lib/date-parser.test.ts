import { describe, it, expect } from 'vitest';
import { parseDateNL } from './date-parser';

const ref = new Date('2026-06-15T10:00:00');

describe('parseDateNL', () => {
  it('returns null for empty input', () => {
    expect(parseDateNL('', ref)).toBeNull();
    expect(parseDateNL('   ', ref)).toBeNull();
  });

  it('parses Chinese relative dates (chrono zh)', () => {
    const r = parseDateNL('今天', ref);
    expect(r).not.toBeNull();
    expect(r!.source).toBe('zh');
    expect(r!.date.toDateString()).toBe(new Date('2026-06-15').toDateString());
  });

  it('parses 明天', () => {
    const r = parseDateNL('明天', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-16').toDateString());
  });

  it('parses 后天', () => {
    const r = parseDateNL('后天', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-17').toDateString());
  });

  it('parses 大后天', () => {
    const r = parseDateNL('大后天', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-18').toDateString());
  });

  it('parses 周三 (this week Wednesday)', () => {
    const r = parseDateNL('周三', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-17').toDateString());
  });

  it('parses 下周三', () => {
    const r = parseDateNL('下周三', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-24').toDateString());
  });

  it('parses 这周三 (same as 周三 this week)', () => {
    const r = parseDateNL('这周三', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-17').toDateString());
  });

  it('parses 下周一', () => {
    const r = parseDateNL('下周一', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-22').toDateString());
  });

  it('parses 3天后', () => {
    const r = parseDateNL('3天后', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-18').toDateString());
  });

  it('parses 6月20 (date in same year)', () => {
    const r = parseDateNL('6月20', ref);
    expect(r!.date.getMonth()).toBe(5);
    expect(r!.date.getDate()).toBe(20);
  });

  it('parses 明天下午3点 with time', () => {
    const r = parseDateNL('明天下午3点', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-16').toDateString());
    expect(r!.date.getHours()).toBe(15);
  });

  it('parses 今晚', () => {
    const r = parseDateNL('今晚', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-15').toDateString());
  });

  it('parses English "tomorrow" via en fallback', () => {
    const r = parseDateNL('tomorrow', ref);
    expect(r).not.toBeNull();
    expect(r!.source).toBe('en');
    expect(r!.date.toDateString()).toBe(new Date('2026-06-16').toDateString());
  });

  it('parses English "next monday"', () => {
    const r = parseDateNL('next monday', ref);
    expect(r!.date.toDateString()).toBe(new Date('2026-06-22').toDateString());
  });

  it('parses 6/20 via en fallback', () => {
    const r = parseDateNL('6/20', ref);
    expect(r).not.toBeNull();
    expect(r!.source).toBe('en');
    expect(r!.date.getMonth()).toBe(5);
    expect(r!.date.getDate()).toBe(20);
  });

  it('custom: 周末 (next Saturday)', () => {
    const r = parseDateNL('周末', ref);
    expect(r!.source).toBe('custom');
    expect(r!.date.toDateString()).toBe(new Date('2026-06-20').toDateString());
  });

  it('custom: 下周 (today + 7 days)', () => {
    const r = parseDateNL('下周', ref);
    expect(r!.source).toBe('custom');
    expect(r!.date.toDateString()).toBe(new Date('2026-06-22').toDateString());
  });

  it('custom: 上周 (today - 7 days)', () => {
    const r = parseDateNL('上周', ref);
    expect(r!.source).toBe('custom');
    expect(r!.date.toDateString()).toBe(new Date('2026-06-08').toDateString());
  });

  it('custom: 2周后', () => {
    const r = parseDateNL('2周后', ref);
    expect(r!.source).toBe('custom');
    expect(r!.date.toDateString()).toBe(new Date('2026-06-29').toDateString());
  });

  it('custom: 1周前', () => {
    const r = parseDateNL('1周前', ref);
    expect(r!.source).toBe('custom');
    expect(r!.date.toDateString()).toBe(new Date('2026-06-08').toDateString());
  });

  it('custom: 下个月 (first of next month)', () => {
    const r = parseDateNL('下个月', ref);
    expect(r!.source).toBe('custom');
    expect(r!.date.getFullYear()).toBe(2026);
    expect(r!.date.getMonth()).toBe(6);
    expect(r!.date.getDate()).toBe(1);
  });

  it('custom: 下个月15号', () => {
    const r = parseDateNL('下个月15号', ref);
    expect(r!.source).toBe('custom');
    expect(r!.date.getMonth()).toBe(6);
    expect(r!.date.getDate()).toBe(15);
  });

  it('returns null for nonsense input', () => {
    expect(parseDateNL('hello world', ref)).toBeNull();
  });
});
