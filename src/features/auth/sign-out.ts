"use client";

import { getBrowserSupabase } from "@/lib/supabase/browser";
import { clearCachedAccountData } from "./local-data";

/** Sign out, forget this account's cached data on the device, and go to /connexion (full reload). */
export async function signOutAndLeave(): Promise<void> {
  try {
    await getBrowserSupabase().auth.signOut();
  } finally {
    clearCachedAccountData();
    // Full reload on purpose: drops the previous in-memory query cache.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/connexion");
  }
}
