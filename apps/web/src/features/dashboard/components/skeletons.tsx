"use client";

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={["bg-white/5 rounded animate-pulse", className].filter(Boolean).join(" ")} />
  );
}

export function AllocationPieSkeleton() {
  return (
    <div
      className="bg-panel border border-line rounded-[10px] p-6 flex gap-7 items-center"
      role="status"
      aria-label="Loading allocation"
    >
      <SkeletonBox className="w-[168px] h-[168px] rounded-full shrink-0" />
      <div className="flex-1 min-w-[200px] flex flex-col gap-3">
        <SkeletonBox className="h-3 w-full" />
        <SkeletonBox className="h-3 w-5/6" />
        <SkeletonBox className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function HistoryChartSkeleton() {
  return (
    <div className="mt-[26px]" role="status" aria-label="Loading history chart">
      <SkeletonBox className="h-7 w-44" />
      <SkeletonBox className="mt-1.5 h-[170px] w-full md:h-[240px]" />
    </div>
  );
}
