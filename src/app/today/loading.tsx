export default function TodayLoading() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <div className="h-9 w-24 animate-pulse rounded bg-gray-200" />
          <div className="mt-1 h-4 w-40 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="h-8 w-24 animate-pulse rounded bg-gray-200" />
      </header>

      <section>
        <div className="h-5 w-36 animate-pulse rounded bg-gray-200" />
        <ul className="mt-2 space-y-2">
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
        </ul>
      </section>

      <section>
        <div className="h-5 w-36 animate-pulse rounded bg-gray-200" />
        <ul className="mt-2 space-y-2">
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
        </ul>
      </section>

      <section>
        <div className="h-5 w-36 animate-pulse rounded bg-gray-200" />
        <ul className="mt-2 space-y-2">
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
        </ul>
      </section>
    </main>
  );
}
