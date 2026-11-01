import { Ban, Eye, PencilLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { Button } from "@/components/ui";
import { AuthHeading, FormNotice } from "./auth-frame";

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirmer qui tu es",
  email: "Voir ton adresse courriel",
  profile: "Voir ton prénom",
  phone: "Voir ton numéro de téléphone",
  offline_access: "Rester connecté sans te redemander l'accès",
};

function hostOf(uri: string): string {
  try {
    return new URL(uri).host || uri;
  } catch {
    return uri;
  }
}

export function ConsentView({ details, decisionFailed }: { details: OAuthAuthorizationDetails; decisionFailed: boolean }) {
  const client = details.client.name?.trim() || "Une application";
  const scopes = details.scope.split(/\s+/).filter(Boolean);
  const redirectHost = hostOf(details.redirect_uri);
  const switchHref = `/connexion?next=${encodeURIComponent(`/oauth/consent?authorization_id=${details.authorization_id}`)}`;

  return (
    <div className="flex flex-col">
      <AuthHeading
        eyebrow="Demande d'accès"
        title={`${client} veut accéder à ton compte Chez Nous`}
        description="Vérifie ce que cette application pourra faire avant de décider. Elle agira en ton nom, avec exactement tes droits."
      />

      {decisionFailed ? (
        <FormNotice className="mb-4">
          La décision n&apos;a pas pu être enregistrée. La demande a peut-être expiré : recommence depuis {client}.
        </FormNotice>
      ) : null}

      <section aria-labelledby="consent-can" className="rounded-card bg-surface p-4 md:p-5">
        <h2 id="consent-can" className="mb-3 text-sm font-medium text-fg-muted">
          {client} pourra
        </h2>
        <ul className="flex flex-col gap-3 text-base">
          <Ability icon={<Eye aria-hidden />}>
            Lire les dépenses, soldes, budget, listes, tâches, notes, objectifs et infos du condo de ton foyer.
          </Ability>
          <Ability icon={<PencilLine aria-hidden />}>
            Ajouter et modifier des dépenses, des articles de liste, des tâches et des notes, et enregistrer des remboursements, comme toi.
          </Ability>
          <Ability icon={<Ban aria-hidden />}>Rien supprimer. Aucune suppression n&apos;est possible par cet accès.</Ability>
          <Ability icon={<ShieldCheck aria-hidden />}>
            Voir ce que tu vois, y compris tes éléments privés, mais jamais ceux de ton ou ta partenaire.
          </Ability>
        </ul>
      </section>

      <dl className="mt-4 flex flex-col gap-3 rounded-card bg-surface p-4 text-base md:p-5">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-fg-subtle">Compte</dt>
          <dd className="break-all text-fg">{details.user.email}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-fg-subtle">Retour vers</dt>
          <dd className="font-mono text-sm break-all text-fg">{redirectHost}</dd>
        </div>
        {scopes.length ? (
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-fg-subtle">Autorisations demandées</dt>
            <dd>
              <ul className="flex flex-col gap-0.5">
                {scopes.map((s) => (
                  <li key={s} className="text-fg">
                    {SCOPE_LABELS[s] ?? <span className="font-mono text-sm">{s}</span>}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>

      <form method="post" action="/api/oauth/decision" className="mt-8 flex flex-col gap-2 sm:flex-row-reverse">
        <input type="hidden" name="authorization_id" value={details.authorization_id} />
        <Button type="submit" name="decision" value="approve" variant="primary" size="lg" className="sm:flex-1">
          Autoriser
        </Button>
        <Button type="submit" name="decision" value="deny" variant="secondary" size="lg" className="sm:flex-1">
          Refuser
        </Button>
      </form>
      <p className="mt-6 text-sm text-pretty text-fg-subtle">
        Tu pourras retirer cet accès en tout temps dans Réglages, section Claude. Chaque action faite par cet accès y est listée.{" "}
        <Link href={switchHref} className="text-fg-muted underline underline-offset-4 hover:text-fg">
          Pas toi ? Changer de compte
        </Link>
      </p>
    </div>
  );
}

function Ability({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex shrink-0 text-fg-muted [&>svg]:size-4">{icon}</span>
      <span className="text-pretty text-fg">{children}</span>
    </li>
  );
}

export function ConsentError({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col">
      <AuthHeading eyebrow="Demande d'accès" title={title} description={description} />
      <Button asChild variant="secondary" size="lg">
        <Link href="/">Aller à l&apos;accueil</Link>
      </Button>
    </div>
  );
}
