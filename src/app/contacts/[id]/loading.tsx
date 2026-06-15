export default function ContactDetailLoading() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-gray-200" />
          <div className="space-y-2">
            <div className="h-7 w-28 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-14 animate-pulse rounded bg-gray-200" />
          <div className="h-8 w-14 animate-pulse rounded bg-gray-200" />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse space-y-1">
            <div className="h-3 w-12 rounded bg-gray-200" />
            <div className="h-4 w-24 rounded bg-gray-200" />
          </div>
        ))}
      </dl>

      <div className="flex gap-1">
        <div className="h-6 w-14 animate-pulse rounded-full bg-gray-200" />
        <div className="h-6 w-18 animate-pulse rounded-full bg-gray-200" />
      </div>

      <section className="border-t pt-6">
        <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-3 space-y-2">
          <div className="card animate-pulse"><div className="h-16 rounded bg-gray-200" /></div>
          <div className="card animate-pulse"><div className="h-16 rounded bg-gray-200" /></div>
        </div>
      </section>

      <section className="border-t pt-6">
        <div className="h-5 w-20 animate-pulse rounded bg-gray-200" />
        <ul className="mt-2 space-y-2">
          <li className="card animate-pulse"><div className="h-12 rounded bg-gray-200" /></li>
        </ul>
      </section>
    </main>
  );
}
