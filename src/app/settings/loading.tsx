export default function SettingsLoading() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="h-8 w-20 animate-pulse rounded bg-gray-200" />
      <div className="space-y-4 rounded border border-gray-200 p-4">
        <div className="space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
          <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
          <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
          <div className="h-10 w-16 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="h-9 w-16 animate-pulse rounded bg-gray-200" />
      </div>
      <div className="space-y-4 rounded border border-gray-200 p-4">
        <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
      </div>
    </main>
  );
}
