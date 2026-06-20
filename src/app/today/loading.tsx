export default function TodayLoading() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <div className="h-8 w-20 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="h-16 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-16 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-16 animate-pulse rounded-lg bg-gray-200" />
        </div>
      </header>

      <section className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-6 w-24 animate-pulse rounded bg-blue-100" />
            <div className="mt-2 h-4 w-48 animate-pulse rounded bg-blue-100" />
          </div>
          <div className="h-7 w-12 animate-pulse rounded-full bg-white" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-12 animate-pulse rounded-lg bg-white" />
          <div className="h-12 animate-pulse rounded-lg bg-white" />
        </div>
      </section>

      <section>
        <div className="h-6 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-4 w-56 animate-pulse rounded bg-gray-200" />
        <ul className="mt-2 space-y-2">
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
        </ul>
      </section>
    </main>
  );
}
