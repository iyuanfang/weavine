// Local mirror of `weavine_lib::quick::parse` for the web SPA. Tauri clients
// call into Rust directly (`invoke('quick_parse')`); this file is the
// browser/wap counterpart so the front-end never needs to round-trip a
// keystroke through `/api/quick/parse`.
//
// IMPORTANT: this is the source of truth for the browser side. The Rust
// version must stay byte-for-byte aligned with these keyword lists and
// tie-breaker rules — see `apps/web-spa/src/lib/quick/parse.test.ts`,
// which asserts that both implementations agree on a fixed corpus.

import type { ParsedQuick, QuickKind } from '../quick-types';

export const KIND_KEYWORDS_EVENT = [
  '开会', '会议', '约', 'meeting', 'meet', 'conference', 'sync',
  'standup', '1:1', '一对一', '碰头', '面谈',
];

export const KIND_KEYWORDS_ACTION = [
  '待办', '别忘了', '记得做', '提醒我', '帮我做', 'todo', 'task',
  'remind', 'follow up',
];

export const KIND_KEYWORDS_INTERACTION = [
  '吃饭', '通话', '打电话', '喝咖啡', '见面', 'dinner', 'lunch',
  'chat', 'coffee', 'call',
];

export const KIND_KEYWORDS_NOTE = [
  '记一下', '记一笔', '想法', '灵感', '备注', '备忘', '随手记',
  'note', 'thought', 'idea', 'memo', 'remember',
];

function countHits(haystack: string, needles: readonly string[]): number {
  let n = 0;
  for (const k of needles) if (haystack.includes(k)) n += 1;
  return n;
}

function classifyKind(
  s: string,
  due: Date | null,
  now: Date,
): { kind: QuickKind; kindScore: number } {
  const eventHits = countHits(s, KIND_KEYWORDS_EVENT);
  const actionHits = countHits(s, KIND_KEYWORDS_ACTION);
  const interactionHits = countHits(s, KIND_KEYWORDS_INTERACTION);
  const noteHits = countHits(s, KIND_KEYWORDS_NOTE);
  const max = Math.max(eventHits, actionHits, interactionHits, noteHits);

  // No keyword hit → pick based on whether we parsed a time. The earlier
  // version always defaulted to Action; that was the "everything is a todo"
  // complaint.
  if (max === 0) {
    return due
      ? { kind: 'event', kindScore: 0.55 }
      : { kind: 'note', kindScore: 0.55 };
  }

  // Two-way tie-breaker for interaction-keyword inputs:
  //   future ("明天下午吃饭")  → upgrade to Event
  //   past   ("上周和张三吃饭") → keep Interaction
  // Event-keyword inputs stay as Event regardless of time — a past meeting
  // is still a past event, not an interaction.
  if (due && interactionHits > 0 && eventHits === 0 && actionHits === 0 && due > now) {
    return { kind: 'event', kindScore: 0.85 };
  }

  if (noteHits === max && noteHits > 0) return { kind: 'note', kindScore: 0.85 };
  if (eventHits === max) return { kind: 'event', kindScore: 0.9 };
  if (actionHits === max) return { kind: 'action', kindScore: 0.9 };
  return { kind: 'interaction', kindScore: 0.85 };
}

// ── Time phrase parser ────────────────────────────────────────────────────
// Mirrors `quick::chrono_parse` in `src-tauri/src/quick.rs`. The Rust
// version anchors "today" on the caller-supplied `now`; we do the same so
// offline replays and unit tests don't drift against the wall clock.

const WEEKDAYS_CN: Array<[string, number]> = [
  ['周一', 1], ['周二', 2], ['周三', 3], ['周四', 4],
  ['周五', 5], ['周六', 6], ['周日', 0], ['周天', 0],
];

const WEEKDAYS_EN: Array<[string, number]> = [
  ['monday', 0], ['tuesday', 1], ['wednesday', 2], ['thursday', 3],
  ['friday', 4], ['saturday', 5], ['sunday', 6],
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

function parseTimePhrase(s: string): { hour: number; minute: number } | null {
  // HH:MM
  const m24 = s.match(/(\d{1,2}):(\d{2})/);
  if (m24) {
    const h = Number(m24[1]);
    const mm = Number(m24[2]);
    if (h >= 1 && h <= 23 && mm <= 59) return { hour: h, minute: mm };
  }
  // h am / h:mm am / pm
  const m12 = s.toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (m12) {
    let h = Number(m12[1]);
    const mm = m12[2] ? Number(m12[2]) : 0;
    const meridiem = m12[3].toLowerCase();
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    if (h <= 23 && mm <= 59) return { hour: h, minute: mm };
  }
  // 中文 (凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\d{1,2}点(半|一刻|三刻|\d{1,2}分)?
  const cn = s.match(/(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|早)?\s?(\d{1,2})\s*点(\s*半|\s*一刻|\s*三刻|\s*(\d{1,2})\s*分)?/);
  if (cn) {
    const prefix = cn[1] ?? '';
    const hRaw = Number(cn[2]);
    if (hRaw < 1 || hRaw > 12) return null;
    let h = hRaw;
    let mm = 0;
    const suffix = cn[3] ?? '';
    if (suffix.includes('半')) mm = 30;
    else if (suffix.includes('一刻')) mm = 15;
    else if (suffix.includes('三刻')) mm = 45;
    else if (suffix.includes('分')) {
      const num = suffix.match(/(\d{1,2})/);
      if (num) mm = Number(num[1]);
    }
    switch (prefix) {
      case '凌晨':
      case '清晨':
      case '早上':
      case '早晨':
      case '上午':
      case '早':
        if (h === 12) h = 0;
        break;
      case '中午':
        break;
      case '下午':
      case '傍晚':
      case '晚上':
      case '夜里':
        if (h < 12) h += 12;
        break;
    }
    if (h <= 23 && mm <= 59) return { hour: h, minute: mm };
  }
  return null;
}

function chronoParse(s: string, now: Date): Date | null {
  const lower = s.toLowerCase();
  const localToday = startOfDay(now);
  const currentHour = now.getHours();

  let baseDate: Date;
  let defaultHour: number;

  if (lower.includes('今天') || lower.includes('today')) {
    baseDate = localToday; defaultHour = currentHour;
  } else if (lower.includes('明天') || lower.includes('tomorrow')) {
    baseDate = addDays(localToday, 1); defaultHour = currentHour;
  } else if (lower.includes('后天')) {
    baseDate = addDays(localToday, 2); defaultHour = currentHour;
  } else if (lower.includes('下周') || lower.includes('next week')) {
    baseDate = addDays(localToday, 7); defaultHour = 9;
  } else if (lower.includes('上周') || lower.includes('last week')) {
    baseDate = addDays(localToday, -7); defaultHour = 9;
  } else if (lower.includes('下个月') || lower.includes('next month')) {
    baseDate = addDays(localToday, 30); defaultHour = 9;
  } else if (lower.includes('上个月') || lower.includes('last month')) {
    baseDate = addDays(localToday, -30); defaultHour = 9;
  } else {
    let cnHit: { offset: number; hour: number } | null = null;
    for (const [name, target] of WEEKDAYS_CN) {
      if (lower.includes(name)) {
        const current = ((now.getDay() + 6) % 7); // Mon=0 .. Sun=6
        const diff = (target - current + 7) % 7;
        const offset = lower.includes('下') ? diff + 7 : diff === 0 ? 7 : diff;
        cnHit = { offset, hour: 9 };
        break;
      }
    }
    if (cnHit) {
      baseDate = addDays(localToday, cnHit.offset);
      defaultHour = cnHit.hour;
    } else {
      let enHit: { offset: number; hour: number } | null = null;
      for (const [name, target] of WEEKDAYS_EN) {
        if (lower.includes(name)) {
          const current = now.getDay(); // Sun=0 .. Sat=6
          const diff = (target - current + 7) % 7;
          const offset = lower.includes('next') ? diff + 7 : diff === 0 ? 7 : diff;
          enHit = { offset, hour: 9 };
          break;
        }
      }
      if (enHit) {
        baseDate = addDays(localToday, enHit.offset);
        defaultHour = enHit.hour;
      } else {
        const dayMatch = s.match(/(\d{1,2})号/);
        if (dayMatch) {
          const day = Number(dayMatch[1]);
          let d = localToday;
          if (lower.includes('下个月') || lower.includes('next month')) {
            d = addDays(d, 30);
          } else if (day <= d.getDate()) {
            d = addDays(d, 30);
          }
          const withDay = new Date(d.getFullYear(), d.getMonth(), day);
          baseDate = withDay;
          defaultHour = 9;
        } else {
          return null;
        }
      }
    }
  }

  const t = parseTimePhrase(s);
  const hour = t?.hour ?? defaultHour;
  const minute = t?.minute ?? 0;
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0);
}

// ── Contact matching ──────────────────────────────────────────────────────
// Skim-fuzzy equivalent: substring match (case-insensitive) wins at 1.0;
// ASCII-token prefix-of-name at 0.9; phone-last-4 at 0.95. Browser side
// doesn't have the full Contact list — the caller hands us names to score
// against. See `matchContact` in the Rust counterpart.

export interface ContactCandidate {
  id: string;
  name: string;
  nickname: string;
  phone?: string | null;
}

export function matchContactLocal(
  s: string,
  contacts: readonly ContactCandidate[],
): { id: string; score: number } | null {
  const lower = s.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const c of contacts) {
    const candidates = [c.name ?? '', c.nickname ?? ''].filter((x) => x.length > 0);
    for (const cand of candidates) {
      const lowerCand = cand.toLowerCase();
      if (lower.includes(lowerCand)) {
        if (!best || best.score < 1.0) best = { id: c.id, score: 1.0 };
        break;
      }
      // ASCII-token prefix of candidate
      for (const word of lower.split(/[^a-z0-9]+/)) {
        if (word.length >= 2 && lowerCand.startsWith(word)) {
          if (!best || best.score < 0.9) best = { id: c.id, score: 0.9 };
          break;
        }
      }
    }
    if (c.phone) {
      const last4 = c.phone.slice(-4);
      if (last4.length === 4 && s.includes(last4)) {
        if (!best || best.score < 0.95) best = { id: c.id, score: 0.95 };
      }
    }
  }
  return best;
}

function computeConfidence(hasDue: boolean, contactScore: number, kindScore: number): number {
  const dueFactor = hasDue ? 0.4 : 0.0;
  const contactFactor = contactScore * 0.3;
  const kindFactor = kindScore * 0.3;
  return Math.max(0, Math.min(1, dueFactor + contactFactor + kindFactor));
}

export interface ParseOptions {
  now?: Date;
  contacts?: readonly ContactCandidate[];
}

export function parseQuick(input: string, opts: ParseOptions = {}): ParsedQuick {
  const now = opts.now ?? new Date();
  const due = chronoParse(input, now);
  const { kind, kindScore } = classifyKind(input, due, now);
  const contact = opts.contacts ? matchContactLocal(input, opts.contacts) : null;
  const summary = input.trimEnd().replace(/[。．.]+$/, '').trim();
  return {
    kind,
    kind_score: kindScore,
    due: due ? due.toISOString() : null,
    contact_id: contact?.id ?? null,
    contact_match_score: contact?.score ?? 0.0,
    summary,
    raw: input,
    confidence: computeConfidence(due !== null, contact?.score ?? 0, kindScore),
  };
}