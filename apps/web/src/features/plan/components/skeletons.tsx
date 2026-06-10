"use client";

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={["bg-white/5 rounded animate-pulse", className].filter(Boolean).join(" ")} />
  );
}

export function FanChartSkeleton() {
  return (
    <div
      className="rounded-xl border border-app-line bg-app-panel p-4"
      role="status"
      aria-label="Loading projection chart"
    >
      <SkeletonBox className="h-3 w-32 mb-3" />
      <SkeletonBox className="h-px w-full mb-3" />
      <SkeletonBox className="h-80 w-full" />
    </div>
  );
}

/** Placeholder for the confidence card, milestones, and levers, in layout. */
export function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-9" role="status" aria-label="Loading simulation results">
      {/* Confidence card */}
      <div className="rounded-2xl border border-app-line bg-app-panel">
        <div className="flex flex-col md:flex-row">
          {["mc", "hr"].map((key) => (
            <div key={key} className="flex items-center gap-[18px] p-5 md:flex-1">
              <SkeletonBox className="h-[72px] w-[72px] rounded-full" />
              <div className="flex flex-col gap-2">
                <SkeletonBox className="h-2.5 w-24" />
                <SkeletonBox className="h-7 w-16" />
                <SkeletonBox className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-app-line px-5 py-3">
          <SkeletonBox className="h-3 w-2/3" />
        </div>
      </div>

      {/* Milestones + levers: two 4-up rows */}
      {["milestones", "levers"].map((row) => (
        <div key={row} className="flex flex-col gap-4">
          <SkeletonBox className="h-2.5 w-40" />
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBox key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
