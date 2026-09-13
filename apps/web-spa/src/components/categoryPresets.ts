export type CategoryPreset = {
  value: string;
  label: string;
  icon: string;
  color: string;
};

export const EVENT_PRESETS: CategoryPreset[] = [
  { value: '会议', label: '会议', icon: '🤝', color: '#3b82f6' },
  { value: '会面', label: '会面', icon: '☕', color: '#10b981' },
  { value: '提醒', label: '提醒', icon: '⏰', color: '#8b5cf6' },
  { value: '其他', label: '其他', icon: '📌', color: '#9ca3af' },
];

export const ACTION_PRESETS: CategoryPreset[] = [
  { value: '工作', label: '工作', icon: '💼', color: '#3b82f6' },
  { value: '生活', label: '生活', icon: '🏠', color: '#10b981' },
  { value: '社交', label: '社交', icon: '🍻', color: '#ec4899' },
  { value: '学习', label: '学习', icon: '📚', color: '#8b5cf6' },
  { value: '其他', label: '其他', icon: '📌', color: '#9ca3af' },
];

const PRESET_BY_VALUE = (presets: CategoryPreset[]) =>
  Object.fromEntries(presets.map((p) => [p.value, p]));

const DEFAULT_META = { icon: '⚪', color: '#9ca3af' };

export function categoryMeta(
  value: string | null | undefined,
  presets: CategoryPreset[],
): { label: string; icon: string; color: string } {
  if (!value) return { label: '未分类', ...DEFAULT_META };
  const preset = PRESET_BY_VALUE(presets)[value];
  if (preset) return preset;
  return { label: value, ...DEFAULT_META };
}