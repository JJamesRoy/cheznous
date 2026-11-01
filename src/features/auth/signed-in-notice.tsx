"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/ui/cn";
import { clearCachedAccountData } from "./local-data";

/** On auth pages: says when a session already exists, with "Continuer" / "Changer de compte". */
export function SignedInNotice({ next, className }: { next: string; className?: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (alive) setEmail(data.session?.user.email ?? null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!email) return null;
  return (
    <div className={cn("flex flex-col gap-3 rounded-card bg-surface p-4", className)} role="status">
      <p className="text-base text-fg-muted">
        Tu es déjà connecté·e avec <span className="font-medium break-all text-fg">{email}</span>.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => window.location.assign(next)}>
          Continuer
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await getBrowserSupabase().auth.signOut();
            clearCachedAccountData();
            setEmail(null);
            setBusy(false);
          }}
        >
          Changer de compte
        </Button>
      </div>
    </div>
  );
}
