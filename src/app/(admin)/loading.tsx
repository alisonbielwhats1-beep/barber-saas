export default function AdminLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-3 w-24 animate-shimmer rounded" />
          <div className="h-7 w-48 animate-shimmer rounded" />
        </div>
        <div className="h-9 w-40 animate-shimmer rounded-full" />
      </div>

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="h-3 w-20 animate-shimmer rounded" />
              <div className="h-8 w-8 animate-shimmer rounded-lg" />
            </div>
            <div className="h-7 w-28 animate-shimmer rounded" />
          </div>
        ))}
      </div>

      {/* Panels */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-72 animate-shimmer rounded-2xl lg:col-span-2" />
        <div className="h-72 animate-shimmer rounded-2xl" />
      </div>
      <div className="h-48 animate-shimmer rounded-2xl" />
    </div>
  );
}
