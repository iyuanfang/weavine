import { describe, it, expect } from 'vitest';
import { parseQuery } from './parser';

describe('parseQuery', () => {
  it('parses city + category', () => {
    const r = parseQuery('北京 创业 找前端');
    expect(r.city).toBe('北京');
    expect(r.text).toContain('创业');
    expect(r.text).toContain('找前端');
  });

  it('handles only text', () => {
    const r = parseQuery('张三');
    expect(r.text).toBe('张三');
    expect(r.chips).toHaveLength(1);
    expect(r.chips[0].kind).toBe('free');
  });

  it('emits structured chips', () => {
    const r = parseQuery('上海 合作 介绍投资人');
    expect(r.chips.some((c) => c.kind === 'city' && c.value === '上海')).toBe(true);
    expect(r.chips.some((c) => c.kind === 'category' && c.value === '合作')).toBe(true);
    expect(r.chips.some((c) => c.kind === 'free')).toBe(true);
  });

  it('parses multiple free tokens as single text', () => {
    const r = parseQuery('找 前端 工程师');
    expect(r.text).toBe('找 前端 工程师');
  });

  it('returns empty text for empty query', () => {
    const r = parseQuery('');
    expect(r.text).toBe('');
    expect(r.chips).toHaveLength(0);
  });

  it('recognizes city only', () => {
    const r = parseQuery('深圳');
    expect(r.city).toBe('深圳');
    expect(r.text).toBe('');
  });
});
