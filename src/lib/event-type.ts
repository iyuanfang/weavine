export interface CategoryOption {
  value: string;
  label: string;
}

export const EVENT_TYPE_OPTIONS: CategoryOption[] = [
  { value: '会面', label: '会面' },
  { value: '生日', label: '生日' },
  { value: '纪念日', label: '纪念日' },
  { value: '提醒', label: '提醒' },
  { value: '出行', label: '出行' },
  { value: '聚会', label: '聚会' },
  { value: '其他', label: '其他' },
];

const EVENT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

export const DEFAULT_EVENT_TYPE = '会面';

export function formatEventType(type: string | null | undefined): string {
  if (!type) return '';
  return EVENT_TYPE_LABEL[type] ?? type;
}