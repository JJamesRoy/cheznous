/** Safe localStorage access (private mode, SSR, quota errors never throw). */
export function readStorage(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/**
 * A preference mirrored on `<html data-*>` (set before paint by the boot
 * script) and persisted in localStorage. Exposed as an external store so
 * React reads it with `useSyncExternalStore` without hydration mismatches.
 */
export function createDatasetStore<T extends string>(options: {
  attribute: string;
  storageKey: string;
  fallback: T;
  parse: (raw: string | null) => T;
  /** Value written to the dataset; `null` removes the attribute. */
  toDataset?: (value: T) => string | null;
}) {
  const listeners = new Set<() => void>();
  const { attribute, storageKey, fallback, parse } = options;
  const toDataset = options.toDataset ?? ((value: T) => value);

  function get(): T {
    if (typeof window === "undefined") return fallback;
    return parse(readStorage(storageKey));
  }

  function set(value: T): void {
    writeStorage(storageKey, value);
    const datasetValue = toDataset(value);
    const root = document.documentElement;
    if (datasetValue === null) root.removeAttribute(`data-${attribute}`);
    else root.setAttribute(`data-${attribute}`, datasetValue);
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const value = get();
      const datasetValue = toDataset(value);
      const root = document.documentElement;
      if (datasetValue === null) root.removeAttribute(`data-${attribute}`);
      else root.setAttribute(`data-${attribute}`, datasetValue);
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return { get, set, subscribe, getServerSnapshot: () => fallback };
}
