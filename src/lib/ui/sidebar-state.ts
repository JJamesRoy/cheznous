"use client";

import { useSyncExternalStore } from "react";
import { createDatasetStore } from "./storage";

/** Desktop sidebar collapsed state (`cn-sidebar`), applied before paint. */
const sidebarStore = createDatasetStore<"expanded" | "collapsed">({
  attribute: "sidebar",
  storageKey: "cn-sidebar",
  fallback: "expanded",
  parse: (raw) => (raw === "collapsed" ? "collapsed" : "expanded"),
  toDataset: (value) => (value === "collapsed" ? "collapsed" : null),
});

export function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const state = useSyncExternalStore(
    sidebarStore.subscribe,
    sidebarStore.get,
    sidebarStore.getServerSnapshot,
  );
  return [state === "collapsed", (collapsed) => sidebarStore.set(collapsed ? "collapsed" : "expanded")];
}
