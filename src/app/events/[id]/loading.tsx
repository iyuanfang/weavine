export default function EventDetailLoading() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-8 w-14 animate-pulse rounded bg-gray-200" />
      </div>

      <div className="h-4 w-64 animate-pulse rounded bg-gray-200" />

      <section>
        <div className="h-5 w-16 animate-pulse rounded bg-gray-200" />
        <ul className="mt-2 grid gap-1">
          <li className="h-4 w-20 animate-pulse rounded bg-gray-200" />
          <li className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        </ul>
      </section>

      <section>
        <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
        <ul className="mt-2 space-y-2">
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
        </ul>
      </section>

      <section>
        <div className="h-5 w-12 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
        </div>
      </section>
    </main>
  );
}
