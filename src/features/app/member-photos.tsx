"use client";

import { useMemo, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { AvatarPhotoProvider } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { AVATAR_BUCKET } from "@/features/settings/avatar-url";

type Member = { displayName: string; avatarPath: string | null };

/** Makes every <Avatar name="…"> of a household member show their photo. */
export function MemberPhotosProvider({ members, children }: { members: Member[]; children: ReactNode }) {
  const results = useQueries({
    queries: members.map((m) => ({
      // Same key as useAvatarUrl so the signed URL is shared with Settings.
      queryKey: ["avatar-url", m.avatarPath],
      enabled: Boolean(m.avatarPath),
      staleTime: 50 * 60_000,
      queryFn: async () => {
        const { data, error } = await getBrowserSupabase().storage.from(AVATAR_BUCKET).createSignedUrl(m.avatarPath!, 3600);
        if (error) throw error;
        return data.signedUrl;
      },
    })),
  });
  // Stable string key (name → url) so the resolver only changes when a photo does.
  const key = JSON.stringify(
    members.map((m, i) => [m.displayName.trim().toLowerCase(), m.avatarPath ? (results[i]?.data ?? null) : null]),
  );
  const resolve = useMemo(() => {
    const map = new Map(JSON.parse(key) as [string, string | null][]);
    return (name: string) => map.get(name.trim().toLowerCase()) ?? null;
  }, [key]);
  return <AvatarPhotoProvider value={resolve}>{children}</AvatarPhotoProvider>;
}
