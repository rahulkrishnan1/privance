"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Viewport margin kept on both sides, and the gap below the icon.
const EDGE = 12;
const GAP = 8;
// Tooltip width by breakpoint (px), clamped to the viewport at render time.
const WIDTH_MOBILE = 200;
const WIDTH_DESKTOP = 224;
const MOBILE_MAX = 640;

type Pos = { left: number; top: number; width: number };

// Only one tooltip is open at a time across the page: opening one closes the
// previously open one. Module-level so every InfoTip shares the single slot.
let activeClose: (() => void) | null = null;

/**
 * Info affordance. The tooltip is portalled to <body> and positioned with fixed
 * coordinates clamped to the viewport, so it never overflows and always keeps a
 * margin from both page edges regardless of where the icon sits (left, centre,
 * or right) or how the surrounding layout reflows between desktop and mobile.
 * Opens on hover (mouse), tap (touch), and focus (keyboard). Only one is open at
 * a time, and an open tooltip dismisses on outside tap, scroll, or Escape.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const open = pos !== null;

  const hide = useCallback(() => {
    setPos(null);
    if (activeClose === hide) activeClose = null;
  }, []);

  const show = useCallback(() => {
    const el = btnRef.current;
    if (el === null) return;
    // Close whichever tooltip was open before this one takes the single slot.
    if (activeClose !== null && activeClose !== hide) activeClose();
    activeClose = hide;
    const b = el.getBoundingClientRect();
    // Visual viewport, so a raised soft keyboard on Capacitor/WKWebView (which
    // shifts the visual but not the layout viewport) does not push the tooltip
    // off-screen. Falls back to the layout viewport where it is unavailable.
    const vw = window.visualViewport?.width ?? document.documentElement.clientWidth;
    const width = Math.min(vw < MOBILE_MAX ? WIDTH_MOBILE : WIDTH_DESKTOP, vw - 2 * EDGE);
    const center = b.left + b.width / 2;
    const left = Math.max(EDGE, Math.min(center - width / 2, vw - width - EDGE));
    setPos({ left, top: b.bottom + GAP, width });
  }, [hide]);

  // While open, dismiss on a tap outside the icon/tooltip, on any scroll (the
  // fixed tooltip would otherwise detach from the icon), and on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      // The tooltip itself is pointer-events:none, so a tap "on" it resolves to
      // the element behind and counts as outside; only the icon is excluded.
      if (btnRef.current?.contains(e.target as Node)) return;
      hide();
    };
    const onScroll = () => hide();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, hide]);

  // Release the single-open slot if this tip unmounts while still open.
  useEffect(
    () => () => {
      if (activeClose === hide) activeClose = null;
    },
    [hide],
  );

  return (
    <span className="ml-1 inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") hide();
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== "mouse") {
            open ? hide() : show();
          }
        }}
        onFocus={show}
        onBlur={hide}
        className="inline-flex text-app-dim transition-colors hover:text-app-text focus:outline-none focus-visible:text-app-text"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-5.25a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {pos !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
            className="pointer-events-none fixed z-50 rounded-lg border border-app-line bg-app-panel-2 p-2.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-app-muted shadow-sm"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
