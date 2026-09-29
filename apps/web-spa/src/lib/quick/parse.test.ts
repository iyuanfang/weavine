import { describe, expect, it } from 'vitest';

import {
  parseQuick,
  KIND_KEYWORDS_EVENT,
  KIND_KEYWORDS_ACTION,
  KIND_KEYWORDS_INTERACTION,
  KIND_KEYWORDS_NOTE,
} from './parse';

// 2026-08-17 10:00 local — pinned so the tests don't drift against wall
// clock. Matches `fn now()` in `src-tauri/src/quick.rs::tests`.
const NOW = new Date(2026, 7, 17, 10, 0, 0); // month is 0-indexed

describe('quick parser — keyword lists', () => {
  it('event list excludes ambiguous single-character triggers', () => {
    expect(KIND_KEYWORDS_EVENT.some((k) => k === '要')).toBe(false);
    expect(KIND_KEYWORDS_EVENT.some((k) => k === '记得')).toBe(false);
  });

  it('action list no longer matches bare "记得" / "要"', () => {
    expect(KIND_KEYWORDS_ACTION.some((k) => k === '记得')).toBe(false);
    expect(KIND_KEYWORDS_ACTION.some((k) => k === '要')).toBe(false);
  });

  it('all four lists are non-empty and disjoint on Chinese', () => {
    const all = [
      ...KIND_KEYWORDS_EVENT,
      ...KIND_KEYWORDS_ACTION,
      ...KIND_KEYWORDS_INTERACTION,
      ...KIND_KEYWORDS_NOTE,
    ];
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length); // no overlap
  });
});

describe('quick parser — behavior', () => {
  it('"明天下午和张三吃饭" → event (future+interaction upgraded)', () => {
    const r = parseQuick('明天下午和张三吃饭', { now: NOW });
    expect(r.kind).toBe('event');
  });

  it('"上周和张三吃饭" → interaction (past)', () => {
    const r = parseQuick('上周和张三吃饭', { now: NOW });
    expect(r.kind).toBe('interaction');
  });

  it('"明天开会" → event', () => {
    expect(parseQuick('明天开会', { now: NOW }).kind).toBe('event');
  });

  it('"上周开会" → event (event-keyword never downgrades)', () => {
    expect(parseQuick('上周开会', { now: NOW }).kind).toBe('event');
  });

  it('"和张三吃饭" (no time) → interaction', () => {
    expect(parseQuick('和张三吃饭', { now: NOW }).kind).toBe('interaction');
  });

  it('"开会" (no time) → event', () => {
    expect(parseQuick('开会', { now: NOW }).kind).toBe('event');
  });

  it('"记一下今天在读的书" → note', () => {
    expect(parseQuick('记一下今天在读的书', { now: NOW }).kind).toBe('note');
  });

  it('"idea: support wikilinks" → note', () => {
    expect(parseQuick('idea: support wikilinks', { now: NOW }).kind).toBe('note');
  });

  it('"记一下明天的会议要点" → note (note ties beat event)', () => {
    expect(parseQuick('记一下明天的会议要点', { now: NOW }).kind).toBe('note');
  });

  it('"周二下午三点" (no keyword, parses time) → event (was Action)', () => {
    expect(parseQuick('周二下午三点', { now: NOW }).kind).toBe('event');
  });

  it('"刚才电梯里碰到张三" (no keyword, no time) → note (was Action)', () => {
    expect(parseQuick('刚才电梯里碰到张三', { now: NOW }).kind).toBe('note');
  });

  it('"张三" alone (no keyword, no time) → note', () => {
    expect(parseQuick('张三', { now: NOW }).kind).toBe('note');
  });

  it('"明天下午三点要和张三吃饭" → event (bare "要" no longer overrides)', () => {
    expect(parseQuick('明天下午三点要和张三吃饭', { now: NOW }).kind).toBe('event');
  });

  it('"别忘了周三给我爸打电话" → action', () => {
    expect(parseQuick('别忘了周三给我爸打电话', { now: NOW }).kind).toBe('action');
  });

  it('contact match: substring wins at 1.0', () => {
    const r = parseQuick('明天和张三吃饭', {
      now: NOW,
      contacts: [{ id: 'c1', name: '张三', nickname: '' }],
    });
    expect(r.contact_id).toBe('c1');
    expect(r.contact_match_score).toBe(1);
  });

  it('contact match: ASCII prefix of candidate scores 0.9', () => {
    const r = parseQuick('今天和 KK 聊了一下', {
      now: NOW,
      contacts: [{ id: 'c1', name: 'KK林', nickname: '' }],
    });
    expect(r.contact_id).toBe('c1');
    expect(r.contact_match_score).toBeCloseTo(0.9, 5);
  });
});