"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useOnline, usePendingWrites } from "@/lib/data/query";

/**
 * Honest offline state: what works (reading what was already loaded, adding expenses and list
 * items) and what's waiting to sync.
 */
export function OfflineBanner() {
  const online = useOnline();
  const pending = usePendingWrites();
  if (online && pending.length === 0) return null;
  return (
    <div
      role="status"
      className="mt-3 flex items-center gap-2 rounded-card border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted "
      data-testid="offline-banner"
    >
      {online ? <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
      <span>
        {online
          ? `Synchronisation de ${pending.length} élément${pending.length > 1 ? "s" : ""}…`
          : pending.length
            ? `Hors ligne · ${pending.length} élément${pending.length > 1 ? "s" : ""} en attente de synchronisation`
            : "Hors ligne · tu peux consulter les données déjà chargées et ajouter des dépenses ou des articles."}
      </span>
    </div>
  );
}
