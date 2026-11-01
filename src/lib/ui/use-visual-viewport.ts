"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

function getKeyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  // Space covered at the bottom of the layout viewport (on-screen keyboard).
  const inset = window.innerHeight - vv.height - vv.offsetTop;
  return inset > 1 ? Math.round(inset) : 0;
}

function getHeight(): number {
  return Math.round(window.visualViewport?.height ?? window.innerHeight);
}

/**
 * Height in px hidden by the on-screen keyboard (0 when closed). Sheets use
 * it so the focused field is never covered.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getKeyboardInset, () => 0);
}

/** Visible viewport height in px (0 on the server). */
export function useVisualViewportHeight(): number {
  return useSyncExternalStore(subscribe, getHeight, () => 0);
}

export function useVisualViewport(): { keyboardInset: number; height: number } {
  return { keyboardInset: useKeyboardInset(), height: useVisualViewportHeight() };
}
