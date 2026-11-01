"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { createDatasetStore } from "./storage";
import { useHotkeys } from "./use-hotkeys";

/**
 * Privacy mode masks every <Money> as `•••,•• $`. Masking is driven by
 * `<html data-privacy="on">` (set before paint by the boot script) so amounts
 * never flash on load; this context mirrors it for React consumers.
 */
const privacyStore = createDatasetStore<"on" | "off">({
  attribute: "privacy",
  storageKey: "cn-privacy",
  fallback: "off",
  parse: (raw) => (raw === "on" ? "on" : "off"),
  toDataset: (value) => (value === "on" ? "on" : null),
});

type PrivacyContextValue = {
  masked: boolean;
  toggle: () => void;
  setMasked: (masked: boolean) => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(
    privacyStore.subscribe,
    privacyStore.get,
    privacyStore.getServerSnapshot,
  );
  const masked = state === "on";

  const setMasked = useCallback((next: boolean) => privacyStore.set(next ? "on" : "off"), []);
  const toggle = useCallback(
    () => privacyStore.set(privacyStore.get() === "on" ? "off" : "on"),
    [],
  );

  useHotkeys([{ keys: "mod+shift+h", handler: toggle, allowInInputs: true }]);

  const value = useMemo(() => ({ masked, toggle, setMasked }), [masked, toggle, setMasked]);
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used inside <PrivacyProvider>");
  return ctx;
}
