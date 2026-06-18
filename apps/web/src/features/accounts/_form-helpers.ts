// Shared conversions from raw account-form strings to stored values, used by
// both the add path (invest-screen) and the edit path (accounts-view).

/** Percent input ("4.15") to a stored rate fraction ("0.0415"); blank -> undefined. */
export function percentToFraction(pct: string | undefined): string | undefined {
  if (!pct || pct.trim() === "") return undefined;
  const num = Number(pct);
  return Number.isNaN(num) ? undefined : (num / 100).toFixed(4);
}

/** Trim a free-text field to its value, or undefined when empty. */
export function trimToUndefined(s: string | undefined): string | undefined {
  return s && s.trim() !== "" ? s.trim() : undefined;
}
