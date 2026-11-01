"use client";

import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { AuthHeading, FormNotice } from "./auth-frame";
import { authErrorMessage } from "./auth-errors";
import { clearCachedAccountData } from "./local-data";
import { PasswordInput } from "./password-input";
import { safeNext, withNext } from "./safe-next";
import { SignedInNotice } from "./signed-in-notice";

type Mode = "password" | "forgot" | "sent";

const RESEND_COOLDOWN_S = 60;

function contextCopy(next: string): { eyebrow?: string; description: string } {
  if (next.startsWith("/rejoindre/")) return { eyebrow: "Invitation", description: "Connecte-toi pour rejoindre le foyer qui t'a invité·e." };
  if (next.startsWith("/oauth/")) return { eyebrow: "Autorisation", description: "Connecte-toi pour décider de l'accès demandé à ton compte." };
  return { description: "Les dépenses, les listes et le condo, à deux." };
}

export function SignInForm({ next: rawNext, linkError }: { next: string | null; linkError: boolean }) {
  const next = safeNext(rawNext);
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(linkError ? "Ce lien est expiré ou a déjà servi. Demande un nouveau lien." : null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"password" | "link" | null>(null);
  const [sentFor, setSentFor] = useState<"login" | "forgot">("login");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailError(null);
    setBusy("password");
    const { error } = await getBrowserSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(null);
      setError(authErrorMessage(error));
      return;
    }
    clearCachedAccountData();
    window.location.assign(next);
  }

  async function sendLink(kind: "login" | "forgot") {
    setError(null);
    const address = email.trim();
    if (!address) {
      setEmailError("Entre ton courriel pour recevoir le lien.");
      return;
    }
    setEmailError(null);
    setBusy("link");
    const dest = kind === "forgot" ? withNext("/mot-de-passe", next) : next;
    const { error } = await getBrowserSupabase().auth.signInWithOtp({
      email: address,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(dest)}`,
      },
    });
    setBusy(null);
    if (error) {
      setError(authErrorMessage(error));
      return;
    }
    setSentFor(kind);
    setMode("sent");
    setCooldown(RESEND_COOLDOWN_S);
  }

  if (mode === "sent") {
    return (
      <div className="flex flex-col">
        <AuthHeading
          title="Vérifie tes courriels"
          description={
            <>
              On a envoyé un lien de connexion à <span className="font-medium text-fg">{email.trim()}</span>. Ouvre-le sur cet appareil :
              il est valide pendant une heure et ne sert qu&apos;une fois.
              {sentFor === "forgot" ? " Tu pourras ensuite choisir un nouveau mot de passe." : null}
            </>
          }
        />
        {error ? <FormNotice className="mb-4">{error}</FormNotice> : null}
        <div className="flex flex-col gap-2">
          <Button variant="secondary" size="lg" loading={busy === "link"} disabled={cooldown > 0} onClick={() => sendLink(sentFor)}>
            {cooldown > 0 ? (
              <span className="num">Renvoyer le lien ({cooldown} s)</span>
            ) : (
              "Renvoyer le lien"
            )}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() => {
              setMode("password");
              setError(null);
            }}
          >
            Utiliser un autre courriel
          </Button>
        </div>
        <p className="mt-6 text-sm text-fg-subtle">Rien reçu ? Regarde dans les courriels indésirables.</p>
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => {
            setMode("password");
            setError(null);
          }}
          className="-ml-1 mb-4 inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Retour à la connexion
        </button>
        <AuthHeading
          title="Mot de passe oublié"
          description="Pas besoin de le retrouver : on t'envoie un lien qui te connecte directement. Tu pourras ensuite choisir un nouveau mot de passe."
        />
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void sendLink("forgot");
          }}
        >
          <Field label="Courriel" error={emailError ?? undefined}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="toi@exemple.ca"
            />
          </Field>
          {error ? <FormNotice>{error}</FormNotice> : null}
          <Button type="submit" variant="primary" size="lg" loading={busy === "link"}>
            Envoyer le lien
          </Button>
        </form>
      </div>
    );
  }

  const copy = contextCopy(next);
  return (
    <div className="flex flex-col">
      <AuthHeading eyebrow={copy.eyebrow} title="Connexion" description={copy.description} />
      <SignedInNotice next={next} className="mb-6" />
      <form className="flex flex-col gap-4" onSubmit={signIn}>
        <Field label="Courriel" error={emailError ?? undefined}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="toi@exemple.ca"
            required
          />
        </Field>
        <Field
          label="Mot de passe"
          labelAside={
            <button
              type="button"
              className="-my-2 rounded-control py-2 text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              onClick={() => {
                setMode("forgot");
                setError(null);
              }}
            >
              Mot de passe oublié ?
            </button>
          }
        >
          <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error ? <FormNotice>{error}</FormNotice> : null}
        <Button type="submit" variant="primary" size="lg" loading={busy === "password"} disabled={busy === "link"}>
          Se connecter
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-sm text-fg-subtle" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button variant="secondary" size="lg" loading={busy === "link"} disabled={busy === "password"} onClick={() => sendLink("login")}>
        <Mail aria-hidden />
        Recevoir un lien de connexion
      </Button>
      <p className="mt-2 text-sm text-fg-subtle">Sans mot de passe : un lien par courriel, valide une heure.</p>

      <p className="mt-10 text-base text-fg-muted">
        Pas encore de compte ?{" "}
        <Link href={withNext("/inscription", next)} className="font-medium text-fg underline-offset-4 hover:underline">
          Créer un compte
        </Link>
      </p>
    </div>
  );
}
