import type { ActionStatus } from '@/server/services/action';

export const NEXT_STATUS: Record<ActionStatus, ActionStatus | null> = {
  inbox: 'open',
  open: 'done',
  waiting: 'open',
  done: 'open',
  dropped: 'inbox',
};
