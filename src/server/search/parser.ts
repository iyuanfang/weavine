export const KNOWN_CITIES = [
  '北京', '上海', '深圳', '广州', '杭州', '成都', '南京',
  '武汉', '苏州', '西安', '重庆', '天津', '厦门', '青岛',
];

export const KNOWN_CATEGORIES = [
  '交流', '合作', '咨询', '介绍', '帮忙', '其他',
];

export type Chip = {
  kind: 'city' | 'category' | 'free';
  value: string;
};

export type Parsed = {
  text: string;
  city?: string;
  category?: string;
  chips: Chip[];
};

export function parseQuery(q: string): Parsed {
  const chips: Chip[] = [];
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  const remaining: string[] = [];

  let city: string | undefined;
  let category: string | undefined;

  for (const t of tokens) {
    if (!city && KNOWN_CITIES.includes(t)) {
      city = t;
      chips.push({ kind: 'city', value: t });
      continue;
    }
    if (!category && KNOWN_CATEGORIES.includes(t)) {
      category = t;
      chips.push({ kind: 'category', value: t });
      continue;
    }
    remaining.push(t);
  }

  if (remaining.length > 0) {
    chips.push({ kind: 'free', value: remaining.join(' ') });
  }

  return {
    text: remaining.join(' ').trim(),
    city,
    category,
    chips,
  };
}
