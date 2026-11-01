"use client";

// Minimal functional sign-in (to be redesigned by the auth/onboarding work).
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-lg font-semibold tracking-tight">Connexion</h1>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const { error } = await getBrowserSupabase().auth.signInWithPassword({ email, password });
          setBusy(false);
          if (error) return setError("Courriel ou mot de passe invalide.");
          const next = new URLSearchParams(window.location.search).get("next");
          window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
        }}
      >
        <Field label="Courriel">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Mot de passe" error={error ?? undefined}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" loading={busy}>
          Se connecter
        </Button>
      </form>
    </main>
  );
}
