"use client";

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={["bg-white/5 rounded animate-pulse", className].filter(Boolean).join(" ")} />
  );
}

export function NetWorthTileSkeleton() {
  return (
    <div
      className="rounded-xl border border-app-line bg-app-panel p-4 mb-4"
      role="status"
      aria-label="Loading net worth"
    >
      <SkeletonBox className="h-10 w-48 mb-3" />
      <SkeletonBox className="h-5 w-36 mb-4" />
      <SkeletonBox className="h-16 w-full" />
    </div>
  );
}

export function AllocationGridSkeleton() {
  return (
    <div
      className="mb-4 rounded-xl border border-app-line bg-app-panel p-4 flex flex-col items-center"
      role="status"
      aria-label="Loading allocation"
    >
      <SkeletonBox className="w-40 h-40 rounded-full mb-3" />
      <SkeletonBox className="h-3 w-20 mb-2" />
      <SkeletonBox className="h-3 w-28" />
    </div>
  );
}

export function HistoryChartSkeleton() {
  return (
    <div
      className="rounded-xl border border-app-line bg-app-panel p-4 mb-4"
      role="status"
      aria-label="Loading history chart"
    >
      <SkeletonBox className="h-5 w-32 mb-3" />
      <SkeletonBox className="h-px w-full mb-3" />
      <SkeletonBox className="h-48 w-full" />
    </div>
  );
}

export function TopHoldingsSkeleton() {
  return (
    <div
      className="rounded-xl border border-app-line bg-app-panel p-4"
      role="status"
      aria-label="Loading holdings"
    >
      <SkeletonBox className="h-5 w-28 mb-3" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex justify-between mb-3">
          <SkeletonBox className="h-4 w-16" />
          <SkeletonBox className="h-4 w-12" />
          <SkeletonBox className="h-4 w-20" />
          <SkeletonBox className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}
