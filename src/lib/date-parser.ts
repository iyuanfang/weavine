import * as chrono from 'chrono-node';

const zh = chrono.zh.hans;
const en = chrono.en;

export type ParsedDate = {
  date: Date;
  matchedText: string;
  source: 'zh' | 'en' | 'custom';
};

const WEEKDAY_NAME_TO_INDEX: Record<string, number> = {
  '周日': 0, '周天': 0, '星期日': 0, '星期天': 0, '天': 0,
  '周一': 1, '星期一': 1, '一': 1,
  '周二': 2, '星期二': 2, '二': 2,
  '周三': 3, '星期三': 3, '三': 3,
  '周四': 4, '星期四': 4, '四': 4,
  '周五': 5, '星期五': 5, '五': 5,
  '周六': 6, '星期六': 6, '六': 6,
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function nextWeekday(from: Date, target: number): Date {
  const cur = from.getDay();
  let diff = (target - cur + 7) % 7;
  if (diff === 0) diff = 7;
  const out = new Date(from);
  out.setDate(out.getDate() + diff);
  return out;
}

function tryCustom(input: string, ref: Date): ParsedDate | null {
  const text = input.trim();
  const today = startOfDay(ref);

  if (text === '周末' || text === '本周末' || text === '这周末') {
    return { date: nextWeekday(today, 6), matchedText: text, source: 'custom' };
  }
  if (text === '下周' || text === '下个周') {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return { date: d, matchedText: text, source: 'custom' };
  }
  if (text === '上周' || text === '上个周') {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    return { date: d, matchedText: text, source: 'custom' };
  }

  const weeksMatch = text.match(/^(\d+)\s*周(后|前)$/);
  if (weeksMatch) {
    const n = parseInt(weeksMatch[1], 10);
    const d = new Date(today);
    d.setDate(d.getDate() + n * 7 * (weeksMatch[2] === '后' ? 1 : -1));
    return { date: d, matchedText: text, source: 'custom' };
  }

  const monthDayMatch = text.match(/^(下个?月|下月|这个?月|本月)(\d+)\s*[日号]$/);
  if (monthDayMatch) {
    const isNext = monthDayMatch[1].includes('下');
    const day = parseInt(monthDayMatch[2], 10);
    const d = new Date(today);
    d.setMonth(d.getMonth() + (isNext ? 1 : 0), day);
    return { date: d, matchedText: text, source: 'custom' };
  }

  if (text === '下个月' || text === '下个月') {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { date: d, matchedText: text, source: 'custom' };
  }

  return null;
}

export function parseDateNL(input: string, ref: Date = new Date()): ParsedDate | null {
  const text = input.trim();
  if (!text) return null;

  const zhResult = zh.parseDate(text, ref);
  if (zhResult) {
    return { date: zhResult, matchedText: text, source: 'zh' };
  }

  const enResult = en.parseDate(text, ref);
  if (enResult) {
    return { date: enResult, matchedText: text, source: 'en' };
  }

  return tryCustom(text, ref);
}

/** Format a Date as local datetime string (YYYY-MM-DDTHH:mm) for datetime-local inputs */
export function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function extractDates(input: string, ref: Date = new Date()): ParsedDate[] {
  const text = input.trim();
  if (!text) return [];

  const results: ParsedDate[] = [];

  for (const r of zh.parse(text, ref)) {
    results.push({ date: r.start.date(), matchedText: r.text, source: 'zh' });
  }
  for (const r of en.parse(text, ref)) {
    results.push({ date: r.start.date(), matchedText: r.text, source: 'en' });
  }

  return results;
}
