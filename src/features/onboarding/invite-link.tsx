"use client";

import { Check, Copy, Link2, Share } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ConfirmDialog, Skeleton, toast } from "@/components/ui";
import { ApiError } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { formatDateFr, todayIn } from "@/domain/dates";
import { haptic } from "@/lib/ui/haptics";
import { cn } from "@/lib/ui/cn";

const TZ = "America/Toronto";
const linkKey = (householdId: string) => `cn-invite-link:${householdId}`;

type LiveLink = { url: string; expiresAt: string };

function readStoredLink(householdId: string): LiveLink | null {
  try {
    const raw = window.sessionStorage.getItem(linkKey(householdId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveLink;
    return new Date(parsed.expiresAt).getTime() > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

function storeLink(householdId: string, link: LiveLink | null) {
  try {
    if (link) window.sessionStorage.setItem(linkKey(householdId), JSON.stringify(link));
    else window.sessionStorage.removeItem(linkKey(householdId));
  } catch {
    // Storage blocked: the link simply isn't remembered for this tab.
  }
}

export const formatInstantFr = (iso: string) => formatDateFr(todayIn(TZ, new Date(iso)));

function canShare() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Create / copy / share / revoke the partner invitation link.
 * The raw token exists only in the creation response, so the link is kept for this tab only;
 * after a reload the person can create a fresh one (which revokes the previous).
 */
export function InviteLink({ householdId, householdName, className }: { householdId: string; householdName: string; className?: string }) {
  const pending = useOp("household.pendingInvitation", {});
  const [link, setLink] = useState<LiveLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareable, setShareable] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    // Client-only values (sessionStorage, Web Share API) are read after hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLink(readStoredLink(householdId));
    setShareable(canShare());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [householdId]);

  const invite = useOpMutation("household.invite", {
    invalidate: ["household.pendingInvitation"],
    onSuccess: (r) => {
      const next = { url: `${window.location.origin}${r.path}`, expiresAt: r.expiresAt };
      setLink(next);
      storeLink(householdId, next);
      haptic("success");
    },
  });
  const revoke = useOpMutation("household.revokeInvitation", {
    invalidate: ["household.pendingInvitation"],
    onSuccess: () => {
      setLink(null);
      storeLink(householdId, null);
      toast("Lien d'invitation annulé");
    },
  });

  // A link we hold but the server no longer considers pending (revoked elsewhere, used, expired).
  const serverPending = pending.data?.pending ?? null;
  const live = link && serverPending && Math.abs(new Date(serverPending.expires_at).getTime() - new Date(link.expiresAt).getTime()) < 5_000 ? link : null;

  async function copy() {
    if (!live) return;
    try {
      await navigator.clipboard.writeText(live.url);
      setCopied(true);
      haptic("light");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Copie impossible : sélectionne le lien et copie-le à la main.");
    }
  }

  async function share() {
    if (!live) return;
    try {
      await navigator.share({
        title: `Rejoindre ${householdName} sur Chez Nous`,
        text: `Je t'invite à rejoindre « ${householdName} » sur Chez Nous.`,
        url: live.url,
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") void copy();
    }
  }

  const error = invite.error ?? revoke.error;

  if (pending.isPending) {
    return (
      <div className={cn("flex flex-col gap-3", className)} aria-busy>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-5 w-48" />
      </div>
    );
  }

  if (pending.error) {
    return (
      <div className={cn("flex flex-col items-start gap-2", className)} role="alert">
        <p className="text-base text-fg-muted">{pending.error.message}</p>
        <Button variant="secondary" size="sm" onClick={() => pending.refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {live ? (
        <>
          <div className="flex min-w-0 items-center gap-2 rounded-control bg-surface-2 px-3 py-2.5">
            <Link2 aria-hidden className="size-4 shrink-0 text-fg-subtle" />
            <input
              readOnly
              value={live.url}
              aria-label="Lien d'invitation"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate bg-transparent font-mono text-sm text-fg focus-visible:outline-none"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {shareable ? (
              <Button variant="primary" onClick={share} className="sm:flex-1">
                <Share aria-hidden />
                Partager le lien
              </Button>
            ) : null}
            <Button variant={shareable ? "secondary" : "primary"} onClick={copy} className="sm:flex-1" aria-live="polite">
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Lien copié" : "Copier le lien"}
            </Button>
          </div>
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-sm text-fg-subtle">Valide 7 jours, une seule fois · expire le {formatInstantFr(live.expiresAt)}</p>
            <Button variant="danger-ghost" size="sm" className="-ml-3 sm:-mr-3 sm:ml-0" onClick={() => setConfirmRevoke(true)}>
              Annuler le lien
            </Button>
          </div>
        </>
      ) : serverPending ? (
        <>
          <p className="text-base text-fg-muted">
            Un lien créé le {formatInstantFr(serverPending.created_at)} est encore actif jusqu&apos;au {formatInstantFr(serverPending.expires_at)}.
            Pour le revoir, crée un nouveau lien : l&apos;ancien cessera de fonctionner.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" loading={invite.isPending} onClick={() => invite.mutate({})} className="sm:flex-1">
              Créer un nouveau lien
            </Button>
            <Button variant="secondary" onClick={() => setConfirmRevoke(true)} className="sm:flex-1">
              Annuler l&apos;invitation
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button variant="primary" size="lg" loading={invite.isPending} onClick={() => invite.mutate({})}>
            <Link2 aria-hidden />
            Créer le lien d&apos;invitation
          </Button>
          <p className="text-sm text-fg-subtle">Valide 7 jours, une seule fois. Envoie-le par texto ou courriel.</p>
        </>
      )}
      {error ? (
        <p className="text-sm text-negative" role="alert">
          {error instanceof ApiError ? error.message : "L'opération a échoué."}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Annuler le lien d'invitation ?"
        description="Le lien ne fonctionnera plus. Tu pourras en créer un nouveau en tout temps."
        confirmLabel="Annuler le lien"
        cancelLabel="Garder"
        destructive
        onConfirm={() => revoke.mutateAsync({}).then(
          () => undefined,
          () => undefined,
        )}
      />
    </div>
  );
}
