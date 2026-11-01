"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. On the server (and during hydration)
 * returns `serverFallback`, then the real value on the client.
 */
export function useMediaQuery(query: string, serverFallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverFallback,
  );
}

/** < 768px: bottom sheets, tab bar, 16px inputs. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767.98px)");
}

/** ≥ 1024px: sidebar layout. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Touch-first devices (coarse pointer, no hover). */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
