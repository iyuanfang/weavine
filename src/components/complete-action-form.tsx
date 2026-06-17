'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

export function CompleteActionForm({
  actionId,
  onComplete,
}: {
  actionId: string;
  onComplete: (fd: FormData) => Promise<void>;
}) {
  const [showResult, setShowResult] = useState(false);

  if (!showResult) {
    return (
      <button
        onClick={() => setShowResult(true)}
        className="btn-primary mt-6"
      >
        标记完成
      </button>
    );
  }

  return (
    <form action={onComplete} className="mt-6 space-y-2">
      <input type="hidden" name="actionId" value={actionId} />
      <label className="text-sm text-gray-600">
        结果如何？写下来会同步到互动记录
      </label>
      <textarea
        name="result"
        placeholder="选填：对方怎么说，下一步计划..."
        className="input-base w-full"
        rows={3}
      />
      <div className="flex gap-2">
        <SubmitButton />
        <button
          type="button"
          onClick={() => setShowResult(false)}
          className="btn-secondary"
        >
          取消
        </button>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? '处理中…' : '完成并记录'}
    </button>
  );
}
