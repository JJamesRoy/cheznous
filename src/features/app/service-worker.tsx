"use client";

import { useEffect } from "react";

/** Registers /sw.js (production builds only, so dev never serves stale code). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("[sw] registration failed", e));
  }, []);
  return null;
}
