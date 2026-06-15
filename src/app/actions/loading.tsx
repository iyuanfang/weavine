export default function ActionsLoading() {
  const CardSkeleton = () => (
    <li className="card animate-pulse space-y-2">
      <div className="h-4 w-3/4 rounded bg-gray-200" />
      <div className="h-3 w-1/2 rounded bg-gray-200" />
    </li>
  );

  const ColumnSkeleton = () => (
    <section className="min-h-[60vh] rounded border border-gray-200 bg-gray-50 p-3">
      <header className="mb-2">
        <div className="flex items-center justify-between">
          <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
          <div className="h-5 w-6 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="mt-1 h-3 w-16 animate-pulse rounded bg-gray-200" />
      </header>
      <ul className="space-y-2">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </ul>
    </section>
  );

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-gray-200" />
        <div className="h-9 w-20 animate-pulse rounded bg-gray-200" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <ColumnSkeleton />
        <ColumnSkeleton />
        <ColumnSkeleton />
        <ColumnSkeleton />
      </div>
    </main>
  );
}
