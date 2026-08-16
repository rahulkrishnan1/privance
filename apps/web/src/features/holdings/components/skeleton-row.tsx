// Mirrors HoldingRow's cell layout so columns don't shift when data loads.
// Tiered rows use .skeleton-shimmer (::after overlay) so the bg-white/[0.07]
// vs bg-white/[0.04] opacity hierarchy is preserved while still getting the
// continuous shimmer sweep. Big-block placeholders use .skeleton (sets its own
// gradient background) because they have no tier color to preserve.
export function SkeletonRow() {
  return (
    <tr>
      <td className="border-t border-line-soft py-[13px] text-left">
        <div className="flex flex-col gap-1">
          <div className="h-4 w-14 rounded bg-white/[0.07] skeleton-shimmer" />
          <div className="h-3 w-24 rounded bg-white/[0.04] skeleton-shimmer" />
        </div>
      </td>
      {/* Day -- desktop only, matching the real table (mobile shows G/L instead) */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] pl-8 text-right">
        <div className="h-4 w-10 rounded bg-white/[0.04] skeleton-shimmer ml-auto" />
      </td>
      {/* Price -- desktop only */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] pl-8 text-right">
        <div className="h-4 w-14 rounded bg-white/[0.07] skeleton-shimmer ml-auto" />
      </td>
      {/* Qty -- desktop only */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] pl-8 text-right">
        <div className="h-4 w-10 rounded bg-white/[0.04] skeleton-shimmer ml-auto" />
      </td>
      {/* Avg cost -- desktop only */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] pl-8 text-right">
        <div className="h-4 w-14 rounded bg-white/[0.07] skeleton-shimmer ml-auto" />
      </td>
      {/* Total cost -- desktop only, beside avg cost */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] pl-8 text-right">
        <div className="h-4 w-14 rounded bg-white/[0.07] skeleton-shimmer ml-auto" />
      </td>
      {/* G/L -- always visible, matching the real table */}
      <td className="border-t border-line-soft py-[13px] pl-8 text-right">
        <div className="h-4 w-16 rounded bg-white/[0.04] skeleton-shimmer ml-auto" />
      </td>
      <td className="border-t border-line-soft py-[13px] pl-8 text-right">
        <div className="h-4 w-20 rounded bg-white/[0.07] skeleton-shimmer ml-auto" />
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
