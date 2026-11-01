"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ListPlus, NotebookPen, Receipt } from "lucide-react";
import { AppShell, type CommandAction } from "@/components/shell";
import { Skeleton } from "@/components/ui";
import { callOp } from "@/lib/data/api";
import { useOp } from "@/lib/data/query";
import { useHouseholdRealtime } from "@/lib/data/realtime";
import { QuickAddProvider, useQuickAdd } from "./quick-add";
import { SessionProvider, type HouseholdSession } from "./session";
import { QuickAddSheets } from "./quick-add-sheets";
import { OfflineBanner } from "./offline-banner";

/**
 * Everything inside the signed-in app: session boot, realtime, recurring materialization,
 * the shell (tab bar / sidebar / ⌘K) and the global quick-add sheets.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useOp("session.get", {}, { staleTime: 60_000 });

  useEffect(() => {
    if (session.error?.code === "UNAUTHENTICATED") router.replace("/connexion");
  }, [session.error, router]);
  useEffect(() => {
    if (session.data && !session.data.household) router.replace("/bienvenue");
  }, [session.data, router]);

  if (!session.data?.household) return <FrameSkeleton error={session.error && session.error.code !== "UNAUTHENTICATED" ? session.error.message : null} onRetry={() => session.refetch()} />;

  return (
    <SessionProvider value={session.data as HouseholdSession}>
      <QuickAddProvider>
        <SignedIn session={session.data as HouseholdSession}>{children}</SignedIn>
      </QuickAddProvider>
    </SessionProvider>
  );
}

function SignedIn({ session, children }: { session: HouseholdSession; children: ReactNode }) {
  const quickAdd = useQuickAdd();
  useHouseholdRealtime(session.household.id);

  // Create due recurring expenses once per app open (idempotent server-side).
  const materialized = useRef(false);
  useEffect(() => {
    if (materialized.current || !navigator.onLine) return;
    materialized.current = true;
    void callOp("recurring.materialize", {}).catch(() => undefined);
  }, []);

  // Manifest shortcut: /?ajouter=depense
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("ajouter") === "depense") quickAdd.open("expense");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = session.household.members.find((m) => m.isMe);
  const actions: CommandAction[] = useMemo(
    () => [
      { id: "new-expense", label: "Nouvelle dépense", shortcut: "N", icon: Receipt, run: () => quickAdd.open("expense") },
      { id: "new-item", label: "Ajouter un article", icon: ListPlus, keywords: ["liste", "épicerie"], run: () => quickAdd.open("item") },
      { id: "new-task", label: "Nouvelle tâche", icon: CheckSquare, run: () => quickAdd.open("task") },
      { id: "new-note", label: "Nouvelle note", icon: NotebookPen, run: () => quickAdd.open("note") },
    ],
    [quickAdd],
  );

  return (
    <AppShell
      user={{ name: me?.displayName ?? session.user.displayName }}
      householdName={session.household.name}
      onQuickAdd={() => quickAdd.open("expense")}
      commandActions={actions}
      search={async (q, signal) => {
        const r = await callOp("notes.search", { q, limit: 8 }, { signal });
        return r.results.map((n) => ({ id: n.id, title: n.title, subtitle: n.snippet.replace(/[«»]/g, ""), href: `/notes/${n.id}` }));
      }}
    >
      <OfflineBanner />
      {children}
      <QuickAddSheets />
    </AppShell>
  );
}

function FrameSkeleton({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1100px] flex-col gap-4 px-4 pt-16" aria-busy={!error}>
      {error ? (
        <div className="text-fg-muted" role="alert">
          <p className="mb-3">{error}</p>
          <button className="text-accent underline-offset-4 hover:underline" onClick={onRetry}>
            Réessayer
          </button>
        </div>
      ) : (
        <>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-3/4" />
          <Skeleton shape="card" className="h-28 w-full" />
          <Skeleton shape="card" className="h-40 w-full" />
        </>
      )}
    </div>
  );
}
