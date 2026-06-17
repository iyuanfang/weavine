export default function NewActionLoading() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="h-8 w-32 animate-pulse rounded bg-gray-200" />
      <div className="h-4 w-64 animate-pulse rounded bg-gray-200" />
      <div className="space-y-3">
        <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-10 w-24 animate-pulse rounded bg-gray-200" />
      </div>
    </main>
  );
}
