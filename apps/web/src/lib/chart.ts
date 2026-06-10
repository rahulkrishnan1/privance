// Compact currency ($1.06M, $300K, $750). Hand-rolled rather than
// Intl.NumberFormat({notation:"compact"}) because Intl's trailing-zero output
// varies by the runtime's ICU version (e.g. "$1.5M" locally vs "$1.50M" in CI),
// which made the labels non-deterministic. Two fraction digits keeps adjacent
// ticks distinct when the axis is zoomed to a narrow range.
export function formatYAxisTick(v: number): string {
  const sign = v < 0 ? "-" : "";
  const n = Math.abs(v);
  if (n >= 1_000_000) return `${sign}$${stripTrailingZeros((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `${sign}$${stripTrailingZeros((n / 1_000).toFixed(2))}K`;
  return `${sign}$${Math.round(n)}`;
}

function stripTrailingZeros(s: string): string {
  return s.replace(/\.?0+$/, "");
}

// Round up to two significant figures so the top axis label is clean
// ($10.43M becomes $11M, $1.072M becomes $1.1M) without ballooning the
// domain: headroom stays under 10%, which preserves the tight zoom that
// near-flat history series rely on.
export function niceCeil(v: number): number {
  if (v <= 0) return v;
  const unit = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.ceil(v / unit) * unit;
}

// Round axis ticks covering [0, max]. The step is a 1/2/2.5/5-times-10^n value
// chosen for ~`targetCount` divisions; the largest tick is the smallest step
// multiple at or above `max`, so the data fits beneath a clean top label with
// no unlabeled boundary line above it. Use the last tick as the y-domain max.
export function niceTicks(max: number, targetCount = 5): number[] {
  if (max <= 0) return [0, 1];
  const rawStep = max / targetCount;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = mag * (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10);
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step * 1e-6; t += step) ticks.push(t);
  return ticks;
}
