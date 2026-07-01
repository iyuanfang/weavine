'use client';

export function ErrorBoundaryFallback({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8">
      <div className="max-w-md rounded-lg border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          初始化失败
        </h2>
        <p className="mb-4 text-sm text-gray-600">{message}</p>
        <div className="space-y-2 text-left text-xs text-gray-500">
          <p>请尝试以下操作：</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>重新启动应用</li>
            <li>如果之前强制关闭了程序，等待几秒再重新打开</li>
            <li>如果问题持续，请删除数据库文件后重试</li>
          </ol>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          重新加载
        </button>
      </div>
    </div>
  );
}
