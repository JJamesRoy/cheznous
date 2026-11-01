"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Field, Skeleton } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { haptic } from "@/lib/ui/haptics";
import { AuthHeading, FormNotice } from "./auth-frame";
import { authErrorMessage } from "./auth-errors";
import { PasswordInput } from "./password-input";
import { safeNext } from "./safe-next";

const MIN_PASSWORD = 8;

/** /mot-de-passe: choose a new password once signed in (after a magic link, or from Réglages). */
export function NewPasswordForm({ next: rawNext }: { next: string | null }) {
  const next = safeNext(rawNext, "/");
  const [state, setState] = useState<"checking" | "signed-out" | "form" | "done">("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getBrowserSupabase()
      .auth.getUser()
      .then(({ data }) => {
        setEmail(data.user?.email ?? null);
        setState(data.user ? "form" : "signed-out");
      });
  }, []);

  if (state === "checking") {
    return (
      <div aria-busy className="flex flex-col gap-4">
        <Skeleton className="h-[34px] w-56" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="mt-6 h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (state === "signed-out") {
    return (
      <div className="flex flex-col">
        <AuthHeading
          title="Nouveau mot de passe"
          description="Pour changer ton mot de passe, connecte-toi d'abord. Si tu l'as oublié, demande un lien de connexion par courriel."
        />
        <Button asChild variant="primary" size="lg">
          <Link href="/connexion?next=%2Fmot-de-passe">Se connecter</Link>
        </Button>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="flex flex-col">
        <AuthHeading title="Mot de passe changé" description="Utilise-le la prochaine fois que tu te connectes." />
        <Button variant="primary" size="lg" onClick={() => window.location.assign(next)}>
          Continuer
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <AuthHeading
        title="Nouveau mot de passe"
        description={
          <>
            Pour <span className="font-medium break-all text-fg">{email}</span>. Au moins {MIN_PASSWORD} caractères.
          </>
        }
      />
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const fe: typeof fieldError = {};
          if (password.length < MIN_PASSWORD) fe.password = `Au moins ${MIN_PASSWORD} caractères.`;
          else if (confirm !== password) fe.confirm = "Les deux mots de passe ne correspondent pas.";
          setFieldError(fe);
          if (fe.password || fe.confirm) return;
          setBusy(true);
          const { error } = await getBrowserSupabase().auth.updateUser({ password });
          setBusy(false);
          if (error) return setError(authErrorMessage(error));
          haptic("success");
          setState("done");
        }}
      >
        <Field label="Nouveau mot de passe" error={fieldError.password}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field label="Confirme le mot de passe" error={fieldError.confirm}>
          <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error ? <FormNotice>{error}</FormNotice> : null}
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Enregistrer le mot de passe
        </Button>
        <Button variant="ghost" size="lg" onClick={() => window.location.assign(next)}>
          Plus tard
        </Button>
      </form>
    </div>
  );
}
