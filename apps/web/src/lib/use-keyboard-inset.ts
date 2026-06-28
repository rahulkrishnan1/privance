"use client";

import { useEffect, useRef, useState } from "react";

// Below this, a viewport inset is browser-chrome jitter (e.g. a collapsing
// toolbar), not a keyboard; real soft keyboards are far taller.
const KEYBOARD_MIN_PX = 100;

export type KeyboardInset = {
  /** Height of the on-screen keyboard in px, 0 when none is shown. */
  height: number;
  /** Visible height above the keyboard in px, null when no keyboard. */
  available: number | null;
};

const NONE: KeyboardInset = { height: 0, available: null };

/** Pure half of {@link useKeyboardInset}, split out so it can be unit-tested. */
export function keyboardInset(
  innerHeight: number,
  viewportHeight: number,
  offsetTop: number,
): KeyboardInset {
  const height = Math.max(0, innerHeight - viewportHeight - offsetTop);
  return height > KEYBOARD_MIN_PX ? { height, available: viewportHeight } : NONE;
}

/**
 * Tracks the on-screen keyboard via the visual viewport. A bottom-anchored
 * sheet uses `height` to lift its bottom edge above the keyboard and
 * `available` to cap its height to the space that remains, so top content (a
 * search field, the first form input) stays on screen. On iOS the layout
 * viewport does not resize for the keyboard, so `position: fixed; bottom: 0`
 * would otherwise sit behind it. Returns the no-keyboard state during SSR and
 * the first client render, so it never causes a hydration mismatch.
 */
export function useKeyboardInset(): KeyboardInset {
  const [inset, setInset] = useState<KeyboardInset>(NONE);
  const current = useRef<KeyboardInset>(NONE);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // visualViewport "scroll" fires for every pixel of the iOS rubber-band as the
    // keyboard rises; skip the state update unless the inset actually changed so a
    // mounted sheet does not re-render on each frame.
    const update = () => {
      const next = keyboardInset(window.innerHeight, vv.height, vv.offsetTop);
      if (next.height === current.current.height && next.available === current.current.available) {
        return;
      }
      current.current = next;
      setInset(next);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
