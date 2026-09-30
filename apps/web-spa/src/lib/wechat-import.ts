// Parser for WeChat contact-DETAIL page screenshots (微信联系人详情页).
// The page is a fixed template — field labels 昵称/微信号/地区/电话/标签 are
// hardcoded WeChat UI strings — so line-based parsing after OCR is reliable.
//
// Expected OCR line sequence (top → bottom):
//   [status-bar time]  <备注名>  昵称：X  微信号: Y  地区：Z  ...
//   朋友资料  电话  18611731560  标签  亲戚，家人  朋友圈  发消息  音视频通话
//
// Returns null when the text does not look like a profile page (e.g. the
// user uploaded a chat or list screenshot).

export interface WechatProfile {
  /** 备注名 — the big title, how YOU named the contact. */
  nickname: string | null;
  /** 昵称 — the name THEY set. */
  name: string | null;
  wechat: string | null;
  phone: string | null;
  address: string | null;
  tags: string[];
}

const NOISE = /^(发消息|音视频通话|朋友圈|朋友资料|···|\.{2,}|<|返回|更多)$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const PHONE_RE = /1[3-9]\d{9}/;

function cleanValue(s: string): string {
  return s.replace(/^[:：\s]+/, '').trim();
}

export function parseWechatProfile(rawText: string): WechatProfile | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !NOISE.test(l) && !TIME_RE.test(l));

  // Page guard: a profile page always carries the 微信号 label.
  if (!lines.some((l) => /^微信号/.test(l))) return null;

  const out: WechatProfile = {
    nickname: null,
    name: null,
    wechat: null,
    phone: null,
    address: null,
    tags: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? '';
    if (out.wechat === null && /^微信号/.test(line)) {
      const inline = line.split(/[:：]/).slice(1).join(':');
      out.wechat = cleanValue(inline) || cleanValue(next) || null;
      continue;
    }
    if (out.name === null && /^昵称/.test(line)) {
      const inline = line.split(/[:：]/).slice(1).join(':');
      out.name = cleanValue(inline) || cleanValue(next) || null;
      continue;
    }
    if (out.address === null && /^地区/.test(line)) {
      const inline = line.split(/[:：]/).slice(1).join(':');
      out.address = cleanValue(inline) || cleanValue(next) || null;
      continue;
    }
    if (out.phone === null && /^电话$/.test(line)) {
      const m = (next + ' ' + line).match(PHONE_RE);
      out.phone = m ? m[0] : null;
      continue;
    }
    if (/^标签$/.test(line) && out.tags.length === 0) {
      const src = next && !/^(朋友圈|电话)$/.test(next) ? next : line;
      const inlineTags = line.split(/[:：]/).slice(1).join(':');
      const tagText = cleanValue(inlineTags) || src;
      out.tags = tagText
        .split(/[，,、\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && !/^(标签)$/.test(t));
      continue;
    }
  }

  // 备注名: the big remark title sits DIRECTLY above the 昵称 row — take
  // the nearest line above it that isn't status-bar junk (which contains
  // digits: 14:01 / 1.50 5G / 65 / KB/s) or the back-arrow chevron.
  const nicknameIdx = lines.findIndex((l) => /^昵称/.test(l));
  if (nicknameIdx > 0) {
    for (let j = nicknameIdx - 1; j >= 0; j--) {
      const cand = lines[j];
      if (cand === '>' || /\d/.test(cand) || cand.length < 2) continue;
      // A no-remark profile shows the wechat id as the big title — but the
      // field rows (微信号/地区/…) may also sit above 昵称 when OCR reorders.
      // Never take a labeled field row as the remark.
      if (/^(微信号|昵称|地区|电话|标签)/.test(cand)) continue;
      out.nickname = cand;
      break;
    }
  }
  // A profile with NO remark shows the wechat id as the big title instead.
  if (!out.nickname && out.name) out.nickname = out.name;

  return out;
}
