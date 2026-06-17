export default function SearchLoading() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="h-8 w-32 animate-pulse rounded bg-gray-200" />
      <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
      <div className="space-y-2">
        <div className="card animate-pulse"><div className="h-16 rounded bg-gray-200" /></div>
        <div className="card animate-pulse"><div className="h-16 rounded bg-gray-200" /></div>
        <div className="card animate-pulse"><div className="h-16 rounded bg-gray-200" /></div>
      </div>
    </main>
  );
}
