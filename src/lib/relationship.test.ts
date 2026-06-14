import { describe, it, expect } from 'vitest';
import { relationshipStrength } from './relationship';

const now = new Date('2026-06-15T10:00:00Z');

describe('relationshipStrength', () => {
  it('returns unknown for null', () => {
    const r = relationshipStrength(null, now);
    expect(r.level).toBe('unknown');
    expect(r.days).toBe(null);
    expect(r.label).toBe('从未联系');
  });

  it('returns fresh for today', () => {
    const r = relationshipStrength(new Date('2026-06-15T08:00:00Z'), now);
    expect(r.level).toBe('fresh');
    expect(r.days).toBe(0);
    expect(r.label).toBe('今天联系');
  });

  it('returns fresh for 30 days', () => {
    const r = relationshipStrength(new Date('2026-05-16T10:00:00Z'), now);
    expect(r.level).toBe('fresh');
    expect(r.days).toBe(30);
  });

  it('returns warm for 60 days', () => {
    const r = relationshipStrength(new Date('2026-04-16T10:00:00Z'), now);
    expect(r.level).toBe('warm');
    expect(r.days).toBe(60);
  });

  it('returns stale for 120 days', () => {
    const r = relationshipStrength(new Date('2026-02-15T10:00:00Z'), now);
    expect(r.level).toBe('stale');
    expect(r.days).toBe(120);
  });

  it('returns cold for 365 days', () => {
    const r = relationshipStrength(new Date('2025-06-15T10:00:00Z'), now);
    expect(r.level).toBe('cold');
    expect(r.days).toBe(365);
  });

  it('respects custom thresholds', () => {
    const r = relationshipStrength(new Date('2026-04-16T10:00:00Z'), now, [7, 14, 30]);
    expect(r.level).toBe('cold');
  });

  it('accepts string date', () => {
    const r = relationshipStrength('2026-06-15T08:00:00Z', now);
    expect(r.level).toBe('fresh');
  });
});
