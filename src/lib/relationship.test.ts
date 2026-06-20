import { describe, it, expect } from 'vitest';
import {
  contactMaintenanceIntervalDays,
  contactMaintenanceReminderDue,
  relationshipStrength,
} from './relationship';

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

  it('returns 1 天前 for previous calendar day even if <24h ago', () => {
    // Scenario: last contact on 2026-06-19 10:00, now is 2026-06-20 08:00
    // Rolling 24h diff = 22 hours → days=0 → "今天联系" (BUG)
    // Calendar-day: 2026-06-19 vs 2026-06-20 → days=1 → "1 天前" (EXPECTED)
    const yesterday = new Date('2026-06-19T10:00:00Z');
    const today = new Date('2026-06-20T08:00:00Z');
    const r = relationshipStrength(yesterday, today);
    expect(r.days).toBe(1);
    expect(r.label).toBe('1 天前');
    expect(r.level).toBe('fresh');
  });
});

describe('contactMaintenanceIntervalDays', () => {
  it('uses custom interval when provided', () => {
    expect(contactMaintenanceIntervalDays('normal', 21)).toBe(21);
  });

  it('uses importance defaults when custom interval is missing', () => {
    expect(contactMaintenanceIntervalDays('important', null)).toBe(14);
    expect(contactMaintenanceIntervalDays('normal', null)).toBe(45);
    expect(contactMaintenanceIntervalDays('low', null)).toBe(90);
  });

  it('falls back to normal for unknown importance', () => {
    expect(contactMaintenanceIntervalDays('other', null)).toBe(45);
  });
});

describe('contactMaintenanceReminderDue', () => {
  it('does not remind when reminders are disabled', () => {
    expect(contactMaintenanceReminderDue({
      reminderEnabled: false,
      importance: 'important',
      reminderIntervalDays: null,
      lastContactedAt: new Date('2026-05-01T10:00:00Z'),
      createdAt: new Date('2026-05-01T10:00:00Z'),
    }, now)).toBe(false);
  });

  it('uses lastContactedAt when deciding whether a reminder is due', () => {
    expect(contactMaintenanceReminderDue({
      reminderEnabled: true,
      importance: 'important',
      reminderIntervalDays: null,
      lastContactedAt: new Date('2026-06-01T10:00:00Z'),
      createdAt: new Date('2026-01-01T10:00:00Z'),
    }, now)).toBe(true);
  });

  it('uses createdAt when a contact has never been contacted', () => {
    expect(contactMaintenanceReminderDue({
      reminderEnabled: true,
      importance: 'low',
      reminderIntervalDays: null,
      lastContactedAt: null,
      createdAt: new Date('2026-03-01T10:00:00Z'),
    }, now)).toBe(true);
  });

  it('honors a custom interval over the importance default', () => {
    expect(contactMaintenanceReminderDue({
      reminderEnabled: true,
      importance: 'low',
      reminderIntervalDays: 7,
      lastContactedAt: new Date('2026-06-08T10:00:00Z'),
      createdAt: new Date('2026-01-01T10:00:00Z'),
    }, now)).toBe(true);
  });
});
