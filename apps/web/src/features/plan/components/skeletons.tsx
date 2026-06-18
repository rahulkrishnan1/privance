"use client";

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={["bg-white/5 rounded animate-pulse", className].filter(Boolean).join(" ")} />
  );
}

/** Placeholder for the answer headline (eyebrow + h1 + anchors), in layout. */
export function PlanHeadlineSkeleton() {
  return (
    <div role="status" aria-label="Loading projection">
      <SkeletonBox className="h-2.5 w-20 mb-3" />
      <SkeletonBox className="h-11 w-64 max-w-full" />
      <div className="mt-7 max-w-xl">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-2.5">
            <SkeletonBox className="h-2.5 w-12" />
            <SkeletonBox className="h-6 w-28" />
          </div>
          <div className="flex flex-col items-end gap-2.5">
            <SkeletonBox className="h-2.5 w-12" />
            <SkeletonBox className="h-6 w-28" />
          </div>
        </div>
        <SkeletonBox className="mt-4 h-[5px] w-full rounded-full" />
        <SkeletonBox className="mt-2.5 h-3 w-48" />
      </div>
    </div>
  );
}

export function FanChartSkeleton() {
  return (
    <div
      className="rounded-[10px] border border-line bg-panel p-6"
      role="status"
      aria-label="Loading projection chart"
    >
      <SkeletonBox className="h-3 w-32 mb-3" />
      <SkeletonBox className="h-80 w-full" />
    </div>
  );
}
