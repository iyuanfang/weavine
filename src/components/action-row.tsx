'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { completeActionQuick } from '@/app/actions/actions';

interface ActionRowProps {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  tone?: 'overdue' | 'today' | 'inbox' | 'suggested';
  priority?: number;
}

export function ActionRow({
  id,
  title,
  subtitle,
  href,
  tone = 'today',
  priority = 0,
}: ActionRowProps) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [, startTransition] = useTransition();

  function handleComplete() {
    setCompleting(true);
    startTransition(async () => {
      await completeActionQuick(id);
      setHiding(true);
      setTimeout(() => router.refresh(), 320);
    });
  }

  const isUrgent = priority >= 1 || tone === 'overdue';
  const toneClasses = {
    overdue: 'border-red-200 bg-red-50',
    today: 'border-amber-200 bg-amber-50/40',
    inbox: 'border-gray-200 bg-white',
    suggested: 'border-accent/40 bg-accent/5 shadow-sm',
  }[tone];
  const priorityAccent = isUrgent
    ? 'border-l-[3px] border-l-red-500 ring-1 ring-inset ring-red-200/70'
    : '';

  return (
    <div
      data-testid="action-row"
      data-action-id={id}
      className={`action-row flex items-center gap-2 rounded border p-3 transition-all ${toneClasses} ${priorityAccent} ${
        hiding ? 'card-out' : ''
      }`}
    >
      <button
        type="button"
        onClick={handleComplete}
        disabled={completing}
        aria-label="完成"
        className="action-check flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-gray-400 bg-white text-transparent transition-all hover:border-accent hover:text-accent disabled:opacity-50"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
          <path d="M6.27 10.87h.71l4.56-4.56-.71-.71-4.2 4.21-1.92-1.92L4 8.6l2.27 2.27z" />
        </svg>
      </button>

      <Link href={href} className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`truncate text-gray-900 ${isUrgent ? 'font-semibold' : 'font-medium'}`}
          >
            {title}
          </span>
          {subtitle && (
            <span className="truncate text-xs text-gray-500">{subtitle}</span>
          )}
        </div>
      </Link>

      {priority > 0 && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
            isUrgent
              ? 'border border-red-200 bg-red-50 font-semibold text-red-700'
              : 'bg-orange-100 font-medium text-orange-700'
          }`}
        >
          P{priority}
        </span>
      )}
    </div>
  );
}