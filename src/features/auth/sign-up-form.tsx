"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { AuthHeading, FormNotice } from "./auth-frame";
import { authErrorMessage } from "./auth-errors";
import { clearCachedAccountData } from "./local-data";
import { PasswordInput } from "./password-input";
import { safeNext, withNext } from "./safe-next";
import { SignedInNotice } from "./signed-in-notice";

const MIN_PASSWORD = 8;

type Errors = Partial<Record<"name" | "email" | "password", string>>;

export function SignUpForm({ next: rawNext }: { next: string | null }) {
  const next = safeNext(rawNext, "/bienvenue");
  const invited = next.startsWith("/rejoindre/");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  function validate(): Errors {
    const e: Errors = {};
    if (!name.trim()) e.name = "Ton prénom est requis.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = "Entre un courriel valide.";
    if (password.length < MIN_PASSWORD) e.password = `Au moins ${MIN_PASSWORD} caractères.`;
    return e;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    const { data, error } = await getBrowserSupabase().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setBusy(false);
      setError(authErrorMessage(error));
      return;
    }
    if (!data.session) {
      // Email confirmation is on (hosted projects): the session comes from the link.
      setBusy(false);
      setConfirmSent(true);
      return;
    }
    clearCachedAccountData();
    window.location.assign(next);
  }

  if (confirmSent) {
    return (
      <AuthHeading
        title="Confirme ton courriel"
        description={
          <>
            On a envoyé un lien à <span className="font-medium text-fg">{email.trim()}</span>. Ouvre-le sur cet appareil pour activer ton
            compte{invited ? " et rejoindre le foyer" : ""}.
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col">
      <AuthHeading
        eyebrow={invited ? "Invitation" : undefined}
        title="Créer un compte"
        description={
          invited
            ? "Crée ton compte, puis tu pourras rejoindre le foyer qui t'a invité·e."
            : "Un compte chacun, un foyer à deux. Ton ou ta partenaire pourra te rejoindre ensuite."
        }
      />
      <SignedInNotice next={next} className="mb-6" />
      <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
        <Field label="Prénom" error={errors.name}>
          <Input autoComplete="given-name" autoCapitalize="words" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Courriel" error={errors.email}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="toi@exemple.ca"
          />
        </Field>
        <Field label="Mot de passe" error={errors.password} hint={`Au moins ${MIN_PASSWORD} caractères.`}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? <FormNotice>{error}</FormNotice> : null}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1">
          Créer mon compte
        </Button>
      </form>
      <p className="mt-10 text-base text-fg-muted">
        Déjà un compte ?{" "}
        <Link href={withNext("/connexion", rawNext)} className="font-medium text-fg underline-offset-4 hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
