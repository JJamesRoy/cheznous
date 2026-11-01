"use client";

/** Key of the persisted TanStack Query cache (see src/lib/data/query.tsx). */
const QUERY_CACHE_KEY = "cn-cache-v1";

/**
 * Forget data cached on this device for the previous account, so the next person
 * signing in on the same browser never sees it, even for a frame.
 */
export function clearCachedAccountData() {
  try {
    window.localStorage.removeItem(QUERY_CACHE_KEY);
  } catch {
    // Storage blocked: nothing was persisted either.
  }
}
