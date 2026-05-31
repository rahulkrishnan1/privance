"use client";

export function SkeletonRow() {
  return (
    <tr className="border-b border-app-line-soft">
      {/* Ticker + name */}
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <div className="h-4 w-14 rounded bg-white/[0.07] animate-pulse" />
          <div className="h-3 w-24 rounded bg-white/[0.04] animate-pulse" />
        </div>
      </td>
      {/* Account chip */}
      <td className="hidden md:table-cell px-3 py-3">
        <div className="h-5 w-20 rounded-full bg-white/[0.04] animate-pulse" />
      </td>
      {/* Shares */}
      <td className="hidden md:table-cell px-3 py-3 text-right">
        <div className="h-4 w-16 rounded bg-white/[0.07] animate-pulse ml-auto" />
      </td>
      {/* Current price */}
      <td className="hidden md:table-cell px-3 py-3 text-right">
        <div className="h-4 w-14 rounded bg-white/[0.07] animate-pulse ml-auto" />
      </td>
      {/* Avg cost */}
      <td className="hidden md:table-cell px-3 py-3 text-right">
        <div className="h-4 w-16 rounded bg-white/[0.07] animate-pulse ml-auto" />
      </td>
      {/* Market value */}
      <td className="px-3 py-3 text-right">
        <div className="h-4 w-20 rounded bg-white/[0.07] animate-pulse ml-auto" />
      </td>
      {/* Gain $ */}
      <td className="hidden md:table-cell px-3 py-3 text-right">
        <div className="h-4 w-16 rounded bg-white/[0.04] animate-pulse ml-auto" />
      </td>
      {/* Gain % */}
      <td className="px-3 py-3 text-right">
        <div className="h-4 w-12 rounded bg-white/[0.04] animate-pulse ml-auto" />
      </td>
      {/* Groups */}
      <td className="hidden md:table-cell px-3 py-3" />
      {/* Actions */}
      <td className="hidden md:table-cell px-3 py-3" />
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
