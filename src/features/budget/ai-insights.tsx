"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, Money, Skeleton } from "@/components/ui";
import { Card, QueryError, Section } from "@/features/condo/ui";
import type { OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";

type Insight = NonNullable<OpOutput<"insights.latest">["insight"]>;
type Advice = NonNullable<Insight["advice"]>;
type Item = Advice["recommendations"][number];

const AREA_LABELS: Record<Item["area"], string> = {
  budget: "Budget",
  depenses: "Dépenses",
  abonnements: "Abonnements",
  hypotheque: "Hypothèque",
  assurance: "Assurance",
  epargne: "Épargne",
  partage: "Partage",
  autre: "Autre",
};
const PRIORITY_ORDER: Record<Item["priority"], number> = { haute: 0, moyenne: 1, basse: 2 };

const dateTimeFr = new Intl.DateTimeFormat("fr-CA", { dateStyle: "long", timeStyle: "short", timeZone: "America/Toronto" });

/**
 * AI recommendations (Claude, OpenRouter as fallback). The last advice is stored and shown
 * as is: the model only runs when the person asks for new advice.
 */
export function AiInsights() {
  const q = useOp("insights.latest", {});
  const [error, setError] = useState<string | null>(null);
  const gen = useOpMutation("insights.generate", {
    invalidate: ["insights.latest"],
    onMutate: () => setError(null),
    onError: (e) => setError(e.message),
  });

  const insight = gen.data?.insight ?? q.data?.insight ?? null;
  const configured = q.data?.configured ?? true;

  return (
    <Section
      title="Conseils IA"
      id="budget-ai"
      description="Des pistes pour optimiser votre budget, à partir de vos chiffres dans Chez Nous. Tes dépenses perso n'y figurent que pour toi."
      action={
        insight && configured ? (
          <Button size="sm" variant="ghost" onClick={() => gen.mutate({})} loading={gen.isPending} disabled={gen.isPending}>
            <RefreshCw aria-hidden /> Régénérer
          </Button>
        ) : null
      }
    >
      <Card className="flex flex-col gap-4 p-4 sm:p-5" aria-busy={gen.isPending}>
        {q.isPending ? (
          <Skeleton className="h-[120px]" />
        ) : q.error ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} what="les conseils" className="bg-transparent p-0" />
        ) : !configured ? (
          <p className="text-base text-fg-muted">Les conseils IA ne sont pas encore configurés sur le serveur (clé ANTHROPIC_API_KEY).</p>
        ) : gen.isPending ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <p className="flex items-center gap-2 text-base text-fg-muted">
              <Sparkles aria-hidden className="size-4 animate-pulse text-accent" /> Analyse de votre budget… (jusqu&apos;à une minute)
            </p>
            <Skeleton className="h-[96px]" />
          </div>
        ) : !insight?.advice ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-base text-fg-muted">
              Claude regarde votre budget, vos récurrences, l&apos;hypothèque et vos objectifs, puis propose des façons concrètes d&apos;économiser.
            </p>
            <Button variant="primary" onClick={() => gen.mutate({})}>
              <Sparkles aria-hidden /> Obtenir des conseils
            </Button>
          </div>
        ) : (
          <AdviceView insight={insight} advice={insight.advice} />
        )}
        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : null}
      </Card>
    </Section>
  );
}

function AdviceView({ insight, advice }: { insight: Insight; advice: Advice }) {
  const items = [...advice.recommendations].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const total = items.reduce((s, r) => s + (r.estimatedMonthlySavingsCents ?? 0), 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-fg">{advice.summary}</p>
      {total > 0 ? (
        <p className="text-sm text-fg-muted">
          Économies estimées : <Money cents={total} round className="font-semibold text-fg" /> par mois
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {items.map((r, i) => (
          <li key={i} className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-fg">{r.title}</h3>
              {r.estimatedMonthlySavingsCents ? (
                <span className="shrink-0 text-sm text-positive">
                  ≈ <Money cents={r.estimatedMonthlySavingsCents} round />/mois
                </span>
              ) : null}
            </div>
            <p className="text-sm text-fg-subtle">
              <span className={cn(r.priority === "haute" && "text-warning")}>Priorité {r.priority}</span> · {AREA_LABELS[r.area]} ·{" "}
              {r.scope === "perso" ? "perso" : "foyer"}
            </p>
            <p className="text-base text-fg-muted">{r.detail}</p>
            <p className="text-base text-fg">
              <span className="font-medium">À faire : </span>
              {r.action}
            </p>
          </li>
        ))}
      </ol>
      {advice.caveats.length ? (
        <ul className="list-disc pl-5 text-sm text-fg-subtle">
          {advice.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-fg-subtle">
        Généré le {dateTimeFr.format(new Date(insight.createdAt))} par {insight.provider === "openrouter" ? `OpenRouter (${insight.model})` : "Claude"}
        {insight.fallbackReason ? ` · repli : ${insight.fallbackReason}` : ""}. Ce sont des pistes, pas des conseils financiers professionnels.
      </p>
    </div>
  );
}
