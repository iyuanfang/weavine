import { extractDates } from './date-parser';

export type QuickLogType = 'interaction' | 'action' | 'event';

export type ContactCandidate = {
  id: string;
  nickname: string;
  name?: string | null;
};

export type ParsedIntent = {
  type: QuickLogType;
  title: string;
  date: Date | null;
  contactId: string | null;
  contactName: string | null;
  location: string | null;
  channel: string | null;
  confidence: number;
};

const LOCATION_RE = /(?:在|去|到)([\u4e00-\u9fff]{2,6}(?:酒店|餐厅|饭馆|咖啡|办公室|大厦|楼|路|街|公园|医院|学校))[\s，,。.]*/;
const CHANNELS = ['微信', '电话', '邮件', '线下', '钉钉', '飞书', 'Slack', '短信'] as const;
const CHANNEL_RE = new RegExp(`(${CHANNELS.join('|')})`);
const PAST_RE = /[了过]|刚|已经|已|曾经|之前/;
const FUTURE_VERB_RE = /发|做|跟进|买|联系|交|送|写|整理|催|追|问|查|确认|提交|安排|处理|回复|转告|搞定|看|办|搜|约|请|带|通知|申请|汇报/;
const MEETING_RE = /见面|开会|约|聚会|吃饭|喝[茶酒]|碰[头面]/;
const NEUTRAL_VERB_RE = /沟通|讨论|确认|同步|对[接齐]|商量|聊/;

function classifyInput(text: string): QuickLogType {
  const hasPast = PAST_RE.test(text);
  const hasFuture = FUTURE_VERB_RE.test(text);
  const hasMeeting = MEETING_RE.test(text);
  const hasNeutral = NEUTRAL_VERB_RE.test(text);
  const hasTime = /[0-9]+[点:：]/.test(text) || /今天|明天|后天|周[一二三四五六日]|下[周个月]|这周|周末/.test(text);

  if (hasPast) return 'interaction';
  if (hasMeeting && hasTime) return 'event';
  if (hasFuture) return 'action';
  if (hasTime && hasMeeting) return 'event';
  if (hasTime && hasNeutral) return 'action';
  return 'action';
}

function extractLocation(text: string): { location: string | null; rest: string } {
  const m = text.match(LOCATION_RE);
  if (m) {
    return { location: m[1], rest: text.replace(m[0], '').trim() };
  }
  return { location: null, rest: text };
}

function extractChannel(text: string): { channel: string | null; rest: string } {
  const m = text.match(CHANNEL_RE);
  if (m) {
    return { channel: m[1], rest: text.replace(m[0], '').trim() };
  }
  return { channel: null, rest: text };
}

function extractContact(
  text: string,
  contacts: ContactCandidate[],
): { contactId: string | null; contactName: string | null; rest: string } {
  // Only match existing contacts — never auto-create new ones
  let best: { id: string; nickname: string; name?: string | null; matched: string } | null = null;

  for (const c of contacts) {
    const names = [c.nickname, c.name].filter(Boolean) as string[];
    for (const n of names) {
      if (n.length < 2) continue;
      if (text.includes(n) && (!best || n.length > best.matched.length)) {
        best = { ...c, matched: n };
      }
    }
  }

  if (best) {
    const rest = text.replace(best.matched, '').trim();
    return { contactId: best.id, contactName: best.nickname, rest };
  }

  return { contactId: null, contactName: null, rest: text };
}

function calcConfidence(type: QuickLogType, title: string, date: unknown, contactId: string | null): number {
  switch (type) {
    case 'interaction':
      return title.length > 0 && contactId !== null ? 0.9 : 0.4;
    case 'action':
      return title.length > 0 ? 0.9 : 0.3;
    case 'event':
      if (title.length > 0 && date !== null) return 0.9;
      if (date !== null) return 0.3;
      return 0.2;
  }
}

/**
 * Parse natural language input into a structured intent.
 * Returns null if input looks like a search query (too short, no actionable content).
 */
export function parseNL(text: string, contacts: ContactCandidate[]): ParsedIntent | null {
  const raw = text.trim();
  if (raw.length < 4) return null;

  // Step 1: extract dates
  const dates = extractDates(raw);
  const date = dates.length > 0 ? dates[0].date : null;

  // Strip matched date text from the string so it doesn't pollute downstream extraction
  let remaining = raw;
  for (const d of dates) {
    remaining = remaining.replace(d.matchedText, '').trim();
  }
  if (!remaining) remaining = raw;

  // Step 2: classify type (use raw — dates don't affect classification)
  const type = classifyInput(raw);

  // Step 3: extract location
  const { location, rest: afterLocation } = extractLocation(remaining);

  // Step 4: extract contact (before channel so contact boundary check sees full text)
  const { contactId, contactName, rest: afterContact } = extractContact(afterLocation, contacts);

  // Step 5: extract channel
  const { channel, rest: afterChannel } = extractChannel(afterContact);

  // Step 6: title = original input (date/contact/etc. are separate fields)
  const title = raw;

  // Step 7: calculate confidence
  const confidence = calcConfidence(type, title, date, contactId);

  // If no meaningful content was found, return null
  if (confidence < 0.3 && title.length < 2 && date === null) return null;

  return {
    type,
    title,
    date,
    contactId,
    contactName,
    location,
    channel,
    confidence,
  };
}