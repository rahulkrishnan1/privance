"use client";

export function SkeletonRow() {
  return (
    <tr className="border-b border-neutral-100 dark:border-neutral-800">
      {/* Ticker + name column */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <div className="h-4 w-14 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" />
          <div className="h-3 w-24 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
        </div>
      </td>
      {/* Account chip */}
      <td className="px-2 py-3">
        <div className="h-5 w-20 rounded-full bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
      </td>
      {/* Shares */}
      <td className="px-2 py-3 text-right">
        <div className="h-4 w-16 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse ml-auto" />
      </td>
      {/* Avg cost */}
      <td className="px-2 py-3 text-right">
        <div className="h-4 w-16 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse ml-auto" />
      </td>
      {/* Price */}
      <td className="px-2 py-3 text-right">
        <div className="h-4 w-14 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse ml-auto" />
      </td>
      {/* Market value */}
      <td className="px-2 py-3 text-right">
        <div className="h-4 w-20 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse ml-auto" />
      </td>
      {/* Day delta */}
      <td className="px-2 py-3 text-right">
        <div className="h-4 w-12 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse ml-auto" />
      </td>
      {/* Groups */}
      <td className="px-2 py-3" />
      {/* Actions */}
      <td className="px-2 py-3" />
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
