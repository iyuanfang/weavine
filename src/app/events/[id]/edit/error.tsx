'use client';

export default function EditEventError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <div className="card mx-auto max-w-md text-center">
        <div className="mb-3 text-4xl">⚠️</div>
        <h1 className="text-xl font-semibold text-gray-900">出错了</h1>
        <p className="mt-2 text-sm text-gray-600">
          {error.message || '发生了意外错误'}
        </p>
        {error.digest && (
          <p className="mt-1 text-xs text-gray-400">错误 ID: {error.digest}</p>
        )}
        <button onClick={reset} className="btn-primary mt-4">
          重试
        </button>
      </div>
    </main>
  );
}
