"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Rows that fit `areaHeight`, floored at the preview (min(total, collapsed)). */
export function fillCount(
  areaHeight: number,
  rowHeight: number,
  total: number,
  collapsed: number,
): number {
  const floor = Math.min(total, collapsed);
  if (rowHeight <= 0) return floor;
  return Math.min(total, Math.max(floor, Math.floor(areaHeight / rowHeight)));
}

/**
 * Keeps two cards in a grid row the same height: a list card renders enough rows
 * to fill its partner-driven height, never fewer than `collapsed`. Returns the
 * row `count` and a `minHeight` (the preview's height) for the area, so it floors
 * at the preview and shrinks back without going sticky. When `active` is false
 * (the mobile stack, where each card sizes to its own content) it returns
 * `collapsed` and `minHeight` 0. `rowRef` goes on the first row to measure one
 * row; `areaRef` on the clipping container whose height the partner dictates.
 */
export function useFillCount<A extends HTMLElement, R extends HTMLElement>({
  active,
  total,
  collapsed,
}: {
  active: boolean;
  total: number;
  collapsed: number;
}) {
  const areaRef = useRef<A>(null);
  const rowRef = useRef<R>(null);
  const [count, setCount] = useState(collapsed);
  const [minHeight, setMinHeight] = useState(0);

  useIsomorphicLayoutEffect(() => {
    if (!active) {
      setCount(Math.min(total, collapsed));
      setMinHeight(0);
      return;
    }
    const area = areaRef.current;
    if (area === null) return;
    const measure = () => {
      const rowHeight = rowRef.current?.offsetHeight ?? 0;
      if (rowHeight <= 0) return;
      setMinHeight(Math.min(total, collapsed) * rowHeight);
      setCount(fillCount(area.clientHeight, rowHeight, total, collapsed));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    measure();
    return () => observer.disconnect();
  }, [active, total, collapsed]);

  return { areaRef, rowRef, count, minHeight };
}
