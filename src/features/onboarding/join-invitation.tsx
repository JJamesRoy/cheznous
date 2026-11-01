"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { useOp, useOpMutation } from "@/lib/data/query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { haptic } from "@/lib/ui/haptics";
import { AuthHeading, FormNotice } from "@/features/auth/auth-frame";
import { withNext } from "@/features/auth/safe-next";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { formatInstantFr } from "./invite-link";

type Status = "valid" | "invalid" | "expired" | "used" | "revoked";
type Preview = { status: Status; householdName: string | null; inviterName: string | null; expiresAt: string | null };

/** The preview RPC is open to anonymous visitors (it only reveals names for a valid token). */
async function anonPreview(token: string): Promise<Preview | null> {
  const { data, error } = await getBrowserSupabase().rpc("invitation_preview", { p_token: token });
  if (error) return null;
  const row = (data as { household_name: string | null; inviter_name: string | null; expires_at: string | null; status: Status }[])[0];
  return row
    ? { status: row.status, householdName: row.household_name, inviterName: row.inviter_name, expiresAt: row.expires_at }
    : { status: "invalid", householdName: null, inviterName: null, expiresAt: null };
}

export function JoinInvitation({ token }: { token: string }) {
  const [auth, setAuth] = useState<{ signedIn: boolean; email: string | null } | null>(null);
  useEffect(() => {
    void getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuth({ signedIn: Boolean(data.session), email: data.session?.user.email ?? null }));
  }, []);

  if (!auth) return <JoinSkeleton />;
  return auth.signedIn ? <SignedInJoin token={token} email={auth.email} /> : <SignedOutJoin token={token} />;
}

function invitedTitle(p: Preview | null) {
  if (p?.householdName && p.inviterName) return `${p.inviterName} t'invite à rejoindre « ${p.householdName} »`;
  if (p?.householdName) return `Tu es invité·e à rejoindre « ${p.householdName} »`;
  return "Tu es invité·e à rejoindre un foyer";
}

const SHARED_COPY = "Vous partagerez les dépenses, le budget, les listes, les tâches et le condo. Ce que tu marques comme privé reste à toi.";

function SignedOutJoin({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  useEffect(() => {
    void anonPreview(token).then(setPreview);
  }, [token]);
  if (preview === undefined) return <JoinSkeleton />;
  if (preview && preview.status !== "valid") return <InvalidInvitation preview={preview} />;

  const next = `/rejoindre/${token}`;
  return (
    <div className="flex flex-col">
      <AuthHeading eyebrow="Invitation" title={invitedTitle(preview)} description={SHARED_COPY} />
      <div className="flex flex-col gap-2">
        <Button asChild variant="primary" size="lg">
          <Link href={withNext("/inscription", next)}>Créer mon compte</Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href={withNext("/connexion", next)}>J&apos;ai déjà un compte</Link>
        </Button>
      </div>
      <p className="mt-6 text-sm text-fg-subtle">
        {preview?.expiresAt ? `Lien valide jusqu'au ${formatInstantFr(preview.expiresAt)}, une seule fois. ` : ""}
        Tu reviendras ici après t&apos;être connecté·e.
      </p>
    </div>
  );
}

function SignedInJoin({ token, email }: { token: string; email: string | null }) {
  const preview = useOp("invitation.preview", { token }, { staleTime: 0 });
  const session = useOp("session.get", {});
  const accept = useOpMutation("invitation.accept", {
    onSuccess: () => {
      haptic("success");
      // Full reload on purpose: drops the previous in-memory query cache.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    },
  });

  if (preview.isPending || session.isPending) return <JoinSkeleton />;
  if (preview.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <AuthHeading title="Impossible de vérifier l'invitation" description={preview.error.message} className="mb-4" />
        <Button variant="secondary" onClick={() => preview.refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }
  const p = preview.data;
  if (p.status !== "valid") return <InvalidInvitation preview={p} />;

  const current = session.data?.household ?? null;
  if (current) {
    return (
      <div className="flex flex-col">
        <AuthHeading
          eyebrow="Invitation"
          title="Tu fais déjà partie d'un foyer"
          description={
            <>
              Ton compte {email ? <span className="font-medium break-all text-fg">{email}</span> : null} est membre de « {current.name} ». On ne
              peut appartenir qu&apos;à un seul foyer. Si l&apos;invitation était pour un autre compte, change de compte.
            </>
          }
        />
        <div className="flex flex-col gap-2">
          <Button asChild variant="primary" size="lg">
            <Link href="/">Aller à « {current.name} »</Link>
          </Button>
          <SignOutButton size="lg" variant="secondary">
            Changer de compte
          </SignOutButton>
        </div>
      </div>
    );
  }

  const name = p.householdName ?? "le foyer";
  return (
    <div className="flex flex-col">
      <AuthHeading eyebrow="Invitation" title={invitedTitle(p)} description={SHARED_COPY} />
      {accept.error ? (
        <FormNotice className="mb-4">
          {accept.error.code === "ALREADY_MEMBER" ? "Tu fais déjà partie d'un foyer : on ne peut appartenir qu'à un seul." : accept.error.message}
        </FormNotice>
      ) : null}
      <Button variant="primary" size="lg" loading={accept.isPending} onClick={() => accept.mutate({ token })}>
        Rejoindre {p.householdName ? `« ${name} »` : name}
      </Button>
      <p className="mt-6 text-sm text-fg-subtle">
        Connecté·e avec <span className="break-all text-fg-muted">{email}</span>.{" "}
        {p.expiresAt ? `Lien valide jusqu'au ${formatInstantFr(p.expiresAt)}.` : null}
      </p>
      <div className="mt-2">
        <SignOutButton className="-ml-3">Pas toi ? Changer de compte</SignOutButton>
      </div>
    </div>
  );
}

function InvalidInvitation({ preview }: { preview: Preview }) {
  const who = preview.inviterName ?? "la personne qui t'a invité·e";
  const copy: Record<Exclude<Status, "valid">, { title: string; description: string }> = {
    expired: {
      title: "Cette invitation est expirée",
      description: `Les liens d'invitation sont valides 7 jours. Demande à ${who} de t'en envoyer un nouveau depuis Réglages, section Partenaire.`,
    },
    used: {
      title: "Cette invitation a déjà servi",
      description: "Chaque lien ne sert qu'une fois. Si c'était toi, connecte-toi avec ce compte-là. Sinon, demande un nouveau lien.",
    },
    revoked: {
      title: "Cette invitation a été annulée",
      description: `${preview.inviterName ?? "La personne qui t'a invité·e"} a annulé ce lien. Demande-lui-en un nouveau.`,
    },
    invalid: {
      title: "Invitation introuvable",
      description: "Vérifie que le lien est complet : il est long et se coupe parfois dans les messages. Sinon, demande un nouveau lien.",
    },
  };
  const c = copy[preview.status as Exclude<Status, "valid">];
  return (
    <div className="flex flex-col">
      <AuthHeading eyebrow="Invitation" title={c.title} description={c.description} />
      <Button asChild variant="secondary" size="lg">
        <Link href="/">Aller à l&apos;accueil</Link>
      </Button>
    </div>
  );
}

function JoinSkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <Skeleton className="mb-2 h-[18px] w-20" />
      <Skeleton className="mb-2 h-[68px] w-full" />
      <Skeleton className="mb-8 h-10 w-full" />
      <Skeleton className="mb-2 h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
