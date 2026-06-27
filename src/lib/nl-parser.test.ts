import { describe, it, expect } from 'vitest';
import { parseNL, type ContactCandidate } from './nl-parser';

const noContacts: ContactCandidate[] = [];

const knownContacts: ContactCandidate[] = [
  { id: 'c1', nickname: '张三', name: '张三' },
  { id: 'c2', nickname: '李四', name: null },
  { id: 'c3', nickname: '王五', name: '小王' },
  { id: 'c4', nickname: '赵六', name: '赵六' },
  { id: 'c5', nickname: '欧阳雪', name: null },
];

function expectParsed(
  input: string,
  expected: Partial<ReturnType<typeof parseNL>>,
  contacts: ContactCandidate[] = noContacts,
) {
  const result = parseNL(input, contacts);
  expect(result).not.toBeNull();
  // 忽略 date 的精确值比较 — 用 dateExists 代替
  if ('date' in expected && expected.date === null) {
    expect(result!.date).toBeNull();
  }
  // 对 confidence 使用 toBeCloseTo
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'confidence') {
      expect(result!.confidence).toBeCloseTo(value as number, 1);
    } else if (key !== 'date') {
      expect((result! as any)[key]).toEqual(value);
    }
  }
  return result!;
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('returns null for empty string', () => {
    expect(parseNL('', noContacts)).toBeNull();
  });

  it('returns null for whitespace', () => {
    expect(parseNL('   ', noContacts)).toBeNull();
  });

  it('returns null for short text (< 4 chars)', () => {
    expect(parseNL('hi', noContacts)).toBeNull();
    expect(parseNL('开会', noContacts)).toBeNull();
    expect(parseNL('123', noContacts)).toBeNull();
  });

  it('processes text with exactly 4 chars', () => {
    const r = parseNL('张三四五', noContacts);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('action');
  });

  it('handles empty contacts array — no new contact created', () => {
    const r = parseNL('和张三开会', []);
    expect(r).not.toBeNull();
    expect(r!.contactName).toBeNull();
    expect(r!.contactId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Classification — type detection
// ---------------------------------------------------------------------------
describe('classification', () => {
  it('past tense → interaction', () => {
    const r = parseNL('昨天和张三见面了', knownContacts);
    expect(r!.type).toBe('interaction');
  });

  it('future verb without time → action', () => {
    const r = parseNL('给张三发邮件', knownContacts);
    expect(r!.type).toBe('action');
  });

  it('meeting verb + time → event', () => {
    const r = parseNL('明天下午和张三开会', knownContacts);
    expect(r!.type).toBe('event');
  });

  it('neutral verb + time → action', () => {
    const r = parseNL('下午和李四沟通', knownContacts);
    expect(r!.type).toBe('action');
  });

  it('no time, no past, no meeting → action (default)', () => {
    const r = parseNL('通知张三', knownContacts);
    expect(r!.type).toBe('action');
  });

  it('past + future verb → past wins as interaction', () => {
    const r = parseNL('刚给张三发了邮件', knownContacts);
    expect(r!.type).toBe('interaction');
  });
});

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------
describe('date extraction', () => {
  it('returns null for no date', () => {
    const r = parseNL('和张三开会', knownContacts);
    expect(r!.date).toBeNull();
  });

  it('extracts relative date 明天', () => {
    const r = parseNL('明天和张三开会', knownContacts);
    expect(r!.type).toBe('event');
    expect(r!.date).not.toBeNull();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(r!.date!.toDateString()).toBe(tomorrow.toDateString());
  });

  it('extracts relative date 今天', () => {
    const r = parseNL('今天和王五打电话', knownContacts);
    expect(r!.date).not.toBeNull();
    expect(r!.date!.toDateString()).toBe(new Date().toDateString());
  });

  it('extracts date with time 明天下午3点', () => {
    const r = parseNL('明天下午3点和张三开会', knownContacts);
    expect(r!.date).not.toBeNull();
    expect(r!.date!.getHours()).toBe(15);
  });

  it('extracts weekday 周三', () => {
    const r = parseNL('周三和赵六见面', knownContacts);
    expect(r!.date).not.toBeNull();
    expect(r!.type).toBe('event');
  });

  it('date text does not pollute downstream extraction', () => {
    // chrono 会把 "明天下午3点" 整体提取，不应残留 "点" 等字段干扰后续
    const r = parseNL('明天下午3点和张三开会', noContacts);
    expect(r).not.toBeNull();
    expect(r!.contactName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Location extraction
// ---------------------------------------------------------------------------
describe('location extraction', () => {
  it('extracts 在 + location', () => {
    const r = parseNL('在希尔顿酒店和张三开会', knownContacts);
    expect(r!.location).toBe('希尔顿酒店');
  });

  it('extracts 去 + location', () => {
    const r = parseNL('去销售办公室和张三开会', knownContacts);
    expect(r!.location).toBe('销售办公室');
  });

  it('extracts 到 + location', () => {
    const r = parseNL('到人民医院看李四', knownContacts);
    expect(r!.location).toBe('人民医院');
  });

  it('location is null when none found', () => {
    const r = parseNL('和张三开会', knownContacts);
    expect(r!.location).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Channel extraction
// ---------------------------------------------------------------------------
describe('channel extraction', () => {
  it('extracts 微信', () => {
    const r = parseNL('给张三发微信', knownContacts);
    expect(r!.channel).toBe('微信');
  });

  it('extracts 电话', () => {
    const r = parseNL('给李四打电话', knownContacts);
    expect(r!.channel).toBe('电话');
  });

  it('extracts 邮件', () => {
    const r = parseNL('给王五发邮件', knownContacts);
    expect(r!.channel).toBe('邮件');
  });

  it('extracts 线下', () => {
    const r = parseNL('和赵六线下见面', knownContacts);
    expect(r!.channel).toBe('线下');
  });

  it('channel is null when none found', () => {
    const r = parseNL('和张三开会', knownContacts);
    expect(r!.channel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Contact extraction — KNOWN contacts only (never auto-create)
// ---------------------------------------------------------------------------
describe('contact extraction — known', () => {
  it('matches by nickname', () => {
    const r = parseNL('明天和张三开会', knownContacts);
    expect(r!.contactId).toBe('c1');
    expect(r!.contactName).toBe('张三');
  });

  it('matches by name field', () => {
    const r = parseNL('和小王吃饭', knownContacts);
    expect(r!.contactId).toBe('c3');
    expect(r!.contactName).toBe('王五');
  });

  it('longest match wins (nickname vs name overlap)', () => {
    const r = parseNL('和赵六见面', knownContacts);
    expect(r!.contactName).toBe('赵六');
  });

  it('skips known contact with 1-char name', () => {
    const oneCharContacts: ContactCandidate[] = [
      { id: 'cx', nickname: '王', name: null },
      { id: 'cy', nickname: '李四', name: null },
    ];
    const r = parseNL('给李四打电话', oneCharContacts);
    expect(r!.contactName).toBe('李四');
  });

  it('returns null contact when no match in known contacts', () => {
    const r = parseNL('明天和张三开会', noContacts);
    expect(r!.contactName).toBeNull();
    expect(r!.contactId).toBeNull();
  });

  it('does not auto-create contact from signal word', () => {
    const r = parseNL('找王五讨论', noContacts);
    expect(r!.contactName).toBeNull();
    expect(r!.contactId).toBeNull();
  });

  it('does not auto-create contact via fallback', () => {
    const r = parseNL('张三明天开会', noContacts);
    expect(r!.contactName).toBeNull();
    expect(r!.contactId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Title (always raw input)
// ---------------------------------------------------------------------------
describe('title', () => {
  it('always equals raw input text', () => {
    const r = parseNL('明天下午3点和张三开会', noContacts);
    expect(r!.title).toBe('明天下午3点和张三开会');
  });

  it('preserves original text even after extraction', () => {
    const r = parseNL('在咖啡厅给张三打电话', noContacts);
    expect(r!.title).toBe('在咖啡厅给张三打电话');
  });
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------
describe('confidence', () => {
  it('event with title + date → 0.9', () => {
    const r = parseNL('明天和张三开会', knownContacts);
    expect(r!.confidence).toBeCloseTo(0.9, 1);
  });

  it('event without date → 0.2', () => {
    const r = parseNL('周末和张三开会', knownContacts);
    expect(r!.type).toBe('event');
    expect(r!.date).toBeNull();
    expect(r!.confidence).toBeCloseTo(0.2, 1);
  });

  it('action with title → 0.9', () => {
    const r = parseNL('发邮件给张三', knownContacts);
    expect(r!.type).toBe('action');
    expect(r!.confidence).toBeCloseTo(0.9, 1);
  });

  it('interaction with title + contact → 0.9', () => {
    const r = parseNL('刚和王五开会', knownContacts);
    expect(r!.type).toBe('interaction');
    expect(r!.confidence).toBeCloseTo(0.9, 1);
  });

  it('action without contact → 0.9 (title exists)', () => {
    const r = parseNL('明天发邮件', noContacts);
    expect(r!.type).toBe('action');
    expect(r!.confidence).toBeCloseTo(0.9, 1);
  });
});

// ---------------------------------------------------------------------------
// Integration scenarios — real-world inputs
// ---------------------------------------------------------------------------
describe('integration scenarios', () => {
  it('明天下午3点和张三开会', () => {
    const r = parseNL('明天下午3点和张三开会', knownContacts);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('event');
    expect(r!.date).not.toBeNull();
    expect(r!.date!.getHours()).toBe(15);
    expect(r!.contactId).toBe('c1');
    expect(r!.contactName).toBe('张三');
    expect(r!.location).toBeNull();
    expect(r!.channel).toBeNull();
    expect(r!.title).toBe('明天下午3点和张三开会');
    expect(r!.confidence).toBeCloseTo(0.9, 1);
  });

  it('昨天给李四打了电话 (past interaction)', () => {
    const r = parseNL('昨天给李四打了电话', knownContacts);
    expect(r!.type).toBe('interaction');
    expect(r!.date).not.toBeNull();
    expect(r!.contactId).toBe('c2');
    expect(r!.contactName).toBe('李四');
    expect(r!.channel).toBe('电话');
  });

  it('提醒王五明天交报告 (action with future contact)', () => {
    const r = parseNL('提醒王五明天交报告', knownContacts);
    expect(r!.type).toBe('action');
    expect(r!.contactId).toBe('c3');
    expect(r!.contactName).toBe('王五');
    expect(r!.date).not.toBeNull();
  });

  it('明天在希尔顿酒店和赵六见面 (event with location)', () => {
    const r = parseNL('明天在希尔顿酒店和赵六见面', knownContacts);
    expect(r!.type).toBe('event');
    expect(r!.location).toBe('希尔顿酒店');
    expect(r!.contactId).toBe('c4');
    expect(r!.contactName).toBe('赵六');
  });

  it('给张三发微信 (action with channel)', () => {
    const r = parseNL('给张三发微信', knownContacts);
    expect(r!.type).toBe('action');
    expect(r!.channel).toBe('微信');
    expect(r!.contactId).toBe('c1');
  });

  it('明天和欧阳雪开会 (3-char name existing contact)', () => {
    const r = parseNL('明天和欧阳雪开会', knownContacts);
    expect(r!.type).toBe('event');
    expect(r!.contactId).toBe('c5');
    expect(r!.contactName).toBe('欧阳雪');
  });

  it('和陌生人开会 (no known contact — no contact matched)', () => {
    const r = parseNL('和陌生人开会', noContacts);
    expect(r!.contactName).toBeNull();
    expect(r!.contactId).toBeNull();
  });

  it('催小李交作业 (no known contact — no contact matched)', () => {
    const r = parseNL('催小李交作业', noContacts);
    expect(r!.contactName).toBeNull();
    expect(r!.contactId).toBeNull();
  });

  it('周三下午去人民医院看朋友 (no contact, has location, action)', () => {
    const r = parseNL('周三下午去人民医院看朋友', noContacts);
    expect(r!.type).toBe('action');
    expect(r!.location).toBe('人民医院');
    expect(r!.date).not.toBeNull();
    expect(r!.contactName).toBeNull();
    expect(r!.contactId).toBeNull();
  });
});
