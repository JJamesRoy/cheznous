"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export const AVATAR_BUCKET = "household-files";

/** Signed URL (1 h) for a private avatar path, or null. */
export function useAvatarUrl(path: string | null | undefined): string | null {
  const q = useQuery({
    queryKey: ["avatar-url", path],
    enabled: Boolean(path),
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().storage.from(AVATAR_BUCKET).createSignedUrl(path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  return path ? (q.data ?? null) : null;
}
