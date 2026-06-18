"use client";

export function SkeletonRow() {
  return (
    <tr className="border-b border-line-soft">
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <div className="h-4 w-14 rounded bg-white/[0.07] animate-pulse" />
          <div className="h-3 w-24 rounded bg-white/[0.04] animate-pulse" />
        </div>
      </td>
      <td className="hidden md:table-cell px-3 py-3 text-right">
        <div className="h-4 w-14 rounded bg-white/[0.07] animate-pulse ml-auto" />
      </td>
      {/* Day -- desktop only, matching the real table (mobile shows G/L instead) */}
      <td className="hidden md:table-cell px-3 py-3 text-right">
        <div className="h-4 w-10 rounded bg-white/[0.04] animate-pulse ml-auto" />
      </td>
      {/* G/L -- always visible, matching the real table */}
      <td className="px-3 py-3 text-right">
        <div className="h-4 w-16 rounded bg-white/[0.04] animate-pulse ml-auto" />
      </td>
      <td className="hidden md:table-cell px-3 py-3 text-right">
        <div className="h-4 w-20 rounded bg-white/[0.04] animate-pulse ml-auto" />
      </td>
      <td className="px-3 py-3 text-right">
        <div className="h-4 w-20 rounded bg-white/[0.07] animate-pulse ml-auto" />
      </td>
    </tr>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => i).map((i) => (
        <SkeletonRow key={`skeleton-${i}`} />
      ))}
    </>
  );
}
