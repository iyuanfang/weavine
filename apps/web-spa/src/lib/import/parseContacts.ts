// parseContacts — CSV / vCard → ParsedContact[].
//
// Used by ContactsList's "导入" button; output feeds
// `adapter.contacts.create()` in a Promise.allSettled concurrency-5
// loop. Only fields that map onto CreateContactInput are emitted —
// tags / relations are handled separately by the caller.

export interface ParsedContact {
  nickname: string;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  wechat?: string | null;
  notes?: string | null;
}

const CSV_HEADER_ALIASES: Record<keyof ParsedContact, string[]> = {
  // 昵称 (short identifier) ≠ 姓名 (full legal name) — do not alias them.
  nickname: ['昵称', 'nickname', 'nick', '短名'],
  name: ['姓名', '全名', 'name', 'full_name', 'fullname'],
  company: ['公司', 'company', 'org', 'organization', '组织'],
  title: ['职位', 'title', 'position', 'job', '职务'],
  city: ['城市', 'city', 'location', '所在地'],
  email: ['邮箱', 'email', 'mail', 'e-mail'],
  phone: ['电话', '手机', 'phone', 'mobile', 'tel', 'telephone'],
  wechat: ['微信', 'wechat', 'wx'],
  notes: ['备注', 'notes', 'note', 'comment', '说明'],
};

// Excel and Numbers prepend a UTF-8 BOM when exporting CSV-UTF-8;
// strip it so the first header column doesn't start with "\uFEFF".
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function tokenizeCsvRow(row: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = row.length;

  while (i < len) {
    if (row[i] === '"') {
      let value = '';
      i += 1;
      while (i < len) {
        if (row[i] === '"') {
          if (row[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          value += row[i];
          i += 1;
        }
      }
      tokens.push(value);
      if (row[i] === ',') i += 1;
    } else {
      const comma = row.indexOf(',', i);
      if (comma === -1) {
        tokens.push(row.slice(i).trim());
        break;
      } else {
        tokens.push(row.slice(i, comma).trim());
        i = comma + 1;
      }
    }
  }

  return tokens;
}

function splitCsvRows(text: string): string[] {
  // Row-aware splitter — tracks open-quote state so embedded newlines
  // inside quoted fields don't truncate the row.
  const rows: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      cur += c;
      inQuotes = !inQuotes;
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (cur.length > 0) rows.push(cur);
      cur = '';
      if (c === '\r' && text[i + 1] === '\n') i += 1;
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) rows.push(cur);
  return rows;
}

export function parseCsv(text: string): ParsedContact[] {
  const stripped = stripBom(text);
  const rows = splitCsvRows(stripped);
  if (rows.length < 2) return [];

  const headers = tokenizeCsvRow(rows[0]).map((h) =>
    h.trim().toLowerCase(),
  );

  const columnIndex = new Map<string, keyof ParsedContact>();
  for (const [field, aliases] of Object.entries(CSV_HEADER_ALIASES) as [
    keyof ParsedContact,
    string[],
  ][]) {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias.toLowerCase());
      if (idx >= 0) {
        // Last alias wins — if a sheet has both 昵称 and 姓名, the
        // rightmost column takes precedence (matches Excel's typical
        // "more specific" override pattern).
        columnIndex.set(headers[idx], field);
      }
    }
  }

  const out: ParsedContact[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const tokens = tokenizeCsvRow(rows[r]);
    if (tokens.length === 0) continue;

    const record: Partial<ParsedContact> = {};

    headers.forEach((header, idx) => {
      const field = columnIndex.get(header);
      if (!field) return;
      const raw = tokens[idx];
      if (raw === undefined) return;
      const value = raw.trim();
      if (!value) return;
      if (field === 'nickname') {
        // Excel sometimes wraps headers/values in literal quotes that
        // survive the round-trip from .xlsx → .csv.
        record.nickname = value.replace(/^"+|"+$/g, '');
      } else {
        record[field] = value;
      }
    });

    if (!record.nickname) {
      // Fallback: CSV with only 姓名 (no 昵称) — use it as nickname so
      // a row with just a full name still imports.
      if (record.name) {
        record.nickname = record.name;
        record.name = null;
      } else {
        continue;
      }
    }
    out.push(record as ParsedContact);
  }

  return out;
}

interface VCardLine {
  property: string;
  params: Record<string, string>;
  value: string;
}

// RFC 6350 §3.2 — a CRLF immediately followed by SP/TAB is a
// continuation of the previous logical line. We also normalise CR.
function unfoldVCard(text: string): string[] {
  const unfolded = stripBom(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
  return unfolded.split('\n').filter((line) => line.length > 0);
}

function parseVCardLine(line: string): VCardLine | null {
  // Split on the FIRST ':' only — values may contain colons (ADR,
  // NOTE, URL). Standard split(':') would corrupt those.
  const colon = line.indexOf(':');
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const headParts = head.split(';');
  const property = headParts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < headParts.length; i += 1) {
    const eq = headParts[i].indexOf('=');
    if (eq < 0) continue;
    const key = headParts[i].slice(0, eq).toLowerCase();
    const val = headParts[i].slice(eq + 1).toLowerCase();
    params[key] = val;
  }

  return { property, params, value };
}

// RFC 6350 N: family;given;additional;prefix;suffix — for the
// nickname we surface "given family" (the colloquial "First Last").
function parseStructuredName(value: string): string {
  const parts = value.split(';');
  const family = (parts[0] || '').trim();
  const given = (parts[1] || '').trim();
  return [given, family].filter(Boolean).join(' ');
}

// RFC 6350 ADR: post-office-box;extended;street;locality;region;postal;country.
// We only surface the locality as the "city" field.
function parseAdrLocality(value: string): string {
  const parts = value.split(';');
  return (parts[3] || '').trim();
}

export function parseVCard(text: string): ParsedContact[] {
  const lines = unfoldVCard(text);
  const out: ParsedContact[] = [];
  let current: Partial<ParsedContact> | null = null;

  const pushCurrent = () => {
    if (!current) return;
    // Fallback: many vcards omit N and only emit FN. Promote FN
    // to nickname so the contact still imports, and drop the
    // redundant `name` field in that case.
    if (!current.nickname && current.name) {
      current.nickname = current.name;
      delete current.name;
    }
    if (current.nickname) {
      out.push(current as ParsedContact);
    }
    current = null;
  };

  for (const line of lines) {
    const parsed = parseVCardLine(line);
    if (!parsed) continue;

    if (parsed.property === 'BEGIN' && parsed.value.toUpperCase() === 'VCARD') {
      current = {};
      continue;
    }
    if (parsed.property === 'END' && parsed.value.toUpperCase() === 'VCARD') {
      pushCurrent();
      continue;
    }
    if (!current) continue;

    switch (parsed.property) {
      case 'N':
        current.nickname = parseStructuredName(parsed.value);
        break;
      case 'FN':
        current.name = parsed.value;
        break;
      case 'ORG': {
        const first = parsed.value.split(';')[0];
        if (first) current.company = first;
        break;
      }
      case 'TITLE':
        current.title = parsed.value;
        break;
      case 'ADR':
        current.city = parseAdrLocality(parsed.value);
        break;
      case 'EMAIL':
        current.email = parsed.value;
        break;
      case 'TEL': {
        // Prefer mobile/cell numbers for the primary phone field.
        const type = parsed.params.type ?? '';
        if (!current.phone || type.includes('cell') || type.includes('mobile')) {
          current.phone = parsed.value;
        }
        break;
      }
      case 'NOTE':
        current.notes = parsed.value;
        break;
      case 'X-WECHAT':
      case 'X-WX':
        current.wechat = parsed.value;
        break;
      default:
        break;
    }
  }

  // Flush in case the file did not terminate with END:VCARD.
  pushCurrent();
  return out;
}