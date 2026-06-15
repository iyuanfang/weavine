export default function ContactsLoading() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-24 animate-pulse rounded bg-gray-200" />
        <div className="h-9 w-16 animate-pulse rounded bg-gray-200" />
      </div>

      <div className="mt-4 flex gap-2">
        <div className="h-10 flex-1 animate-pulse rounded border border-gray-300 bg-gray-200" />
        <div className="h-10 w-28 animate-pulse rounded border border-gray-300 bg-gray-200" />
        <div className="h-10 w-14 animate-pulse rounded bg-gray-200" />
      </div>

      <ul className="mt-4 grid gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="card animate-pulse flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-24 rounded bg-gray-200" />
              <div className="h-3 w-40 rounded bg-gray-200" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
