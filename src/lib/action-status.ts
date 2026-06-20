export type ActionStatus = 'inbox' | 'open' | 'waiting' | 'done' | 'dropped';

export const ACTION_STATUSES = ['inbox', 'open', 'waiting', 'done', 'dropped'] as const;

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  inbox: '📥 收件箱',
  open: '🔨 进行中',
  waiting: '⏳ 等待中',
  done: '✅ 已完成',
  dropped: '🗑 已放弃',
};

export function actionStatusLabel(s: ActionStatus | string | undefined): string {
  if (!s) return '';
  return ACTION_STATUS_LABEL[s as ActionStatus] ?? s;
}
