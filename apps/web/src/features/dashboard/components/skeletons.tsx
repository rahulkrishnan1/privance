"use client";

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={["bg-white/5 rounded animate-pulse", className].filter(Boolean).join(" ")} />
  );
}

export function AllocationPieSkeleton() {
  return (
    <div
      className="bg-panel border border-line rounded-[10px] p-6 h-full"
      role="status"
      aria-label="Loading allocation"
    >
      <SkeletonBox className="h-6 w-28 mb-4" />
      <div className="flex flex-col items-center gap-[18px]">
        <SkeletonBox className="w-[200px] h-[200px] rounded-full" />
        <div className="w-full flex flex-col gap-3">
          <SkeletonBox className="h-3 w-full" />
          <SkeletonBox className="h-3 w-5/6" />
          <SkeletonBox className="h-3 w-2/3" />
        </div>
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
