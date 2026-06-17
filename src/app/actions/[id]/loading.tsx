export default function ActionDetailLoading() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-36 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="h-8 w-14 animate-pulse rounded bg-gray-200" />
      </div>
      <div className="h-10 w-40 animate-pulse rounded bg-gray-200" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <div className="animate-pulse space-y-1">
          <div className="h-3 w-12 rounded bg-gray-200" />
          <div className="h-4 w-24 rounded bg-gray-200" />
        </div>
        <div className="animate-pulse space-y-1">
          <div className="h-3 w-12 rounded bg-gray-200" />
          <div className="h-4 w-20 rounded bg-gray-200" />
        </div>
      </dl>
    </main>
  );
}
