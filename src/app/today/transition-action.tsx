'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { transitionAction } from '@/app/actions/actions';
import { NEXT_STATUS } from './transition-status';
import type { ActionStatus } from '@/server/services/action';

const STATUS_LABEL: Record<ActionStatus, string> = {
  inbox: '→ 待办',
  open: '✓ 完成',
  waiting: '→ 待办',
  done: '↻ 重开',
  dropped: '↻ 恢复',
};

const STATUS_STYLE: Record<ActionStatus, string> = {
  inbox: 'btn-secondary text-sm',
  open: 'btn-primary text-sm',
  waiting: 'btn-secondary text-sm',
  done: 'btn-secondary text-sm',
  dropped: 'btn-secondary text-sm',
};

export function TransitionAction({
  id,
  currentStatus,
}: {
  id: string;
  currentStatus: ActionStatus;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const next = NEXT_STATUS[currentStatus];
  if (!next) return null;
  return (
    <button
      type="button"
      className={STATUS_STYLE[currentStatus]}
      onClick={async () => {
        await transitionAction(id, next);
        startTransition(() => router.refresh());
      }}
    >
      {STATUS_LABEL[currentStatus]}
    </button>
  );
}
