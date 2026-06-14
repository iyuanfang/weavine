'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-semibold">出错了</h1>
      <p className="mt-2 text-sm text-gray-600">
        {error.message || '发生了意外错误'}
      </p>
      <button
        onClick={reset}
        className="btn-primary mt-4"
      >
        重试
      </button>
    </main>
  );
}
