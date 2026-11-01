"use client";

import Link from "next/link";
import { Archive, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/shell";
import {
  AvatarStack,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Money,
  ProgressBar,
  Skeleton,
  toast,
  undoable,
} from "@/components/ui";
import { useSession } from "@/features/app/session";
import { Card, fmtDate, QueryError, relativeFr, Section } from "@/features/condo/ui";
import type { OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { formatMoney } from "@/lib/ui/format";
import { toneForMember } from "@/lib/ui/people";
import { ContributionSheet, GoalSheet } from "./goal-sheets";
import { ProjectsSection } from "./projects";

export type Goal = OpOutput<"goals.list">["goals"][number];

export function GoalsScreen() {
  return (
    <div className="flex flex-col gap-10 pb-8">
      <PageHeader title="Objectifs" description="Ce que vous mettez de côté ensemble, et vos projets." className="pb-0" />
      <GoalsSection />
      <ProjectsSection />
    </div>
  );
}

function GoalsSection() {
  const q = useOp("goals.list", {});
  const [editing, setEditing] = useState<{ goal: Goal | null } | null>(null);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const archive = useOpMutation("goals.archive");

  async function archiveGoal(g: Goal) {
    try {
      await archive.mutateAsync({ id: g.id });
      undoable(`Objectif « ${g.name} » archivé`, () => archive.mutateAsync({ id: g.id, archived: false }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Section
      title="Objectifs d'épargne"
      id="goals"
      action={
        q.data?.goals.length ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing({ goal: null })}>
            <Plus aria-hidden />
            Nouvel objectif
          </Button>
        ) : null
      }
    >
      {q.isPending ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy>
          <Skeleton shape="card" className="h-[236px]" />
          <Skeleton shape="card" className="h-[236px]" />
        </div>
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} what="les objectifs" />
      ) : q.data.goals.length === 0 ? (
        <EmptyState
          message="Mettez de l'argent de côté ensemble : fonds d'urgence, voyage, ou remboursement anticipé de l'hypothèque."
          action={
            <Button variant="primary" onClick={() => setEditing({ goal: null })}>
              Créer un objectif
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {q.data.goals.map((g) => (
            <li key={g.id} className="flex">
              <GoalCard
                g={g}
                onContribute={() => setContributing(g)}
                onEdit={() => setEditing({ goal: g })}
                onArchive={() => void archiveGoal(g)}
              />
            </li>
          ))}
        </ul>
      )}
      <GoalSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} goal={editing?.goal ?? null} />
      <ContributionSheet goal={contributing} onOpenChange={(o) => !o && setContributing(null)} />
    </Section>
  );
}

function GoalCard({ g, onContribute, onEdit, onArchive }: { g: Goal; onContribute: () => void; onEdit: () => void; onArchive: () => void }) {
  const { today, household } = useSession();
  const memberIds = household.members.map((m) => m.userId);
  const contributors = g.members.filter((m) => m.savedCents > 0);
  const isMortgage = g.kind === "mortgage_prepayment";
  const noPrivilege = isMortgage && !g.mortgage?.privilege;

  return (
    <Card as="article" aria-labelledby={`goal-${g.id}`} className="flex w-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 id={`goal-${g.id}`} className="truncate text-md font-semibold text-fg">
            {g.name}
          </h3>
          <span className="text-sm text-fg-subtle">
            {g.kindLabel}
            {g.project ? ` · ${g.project.name}` : ""}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Options pour ${g.name}`} className="-mt-2 -mr-2 text-fg-subtle">
              <MoreHorizontal aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<Pencil />} onSelect={onEdit}>
              Modifier
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Archive />} onSelect={onArchive}>
              Archiver
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {noPrivilege ? (
        <p className="text-base text-fg-muted">
          {g.mortgage?.reason}{" "}
          <Link href="/condo/hypotheque" className="text-fg underline underline-offset-2">
            Compléter l&apos;hypothèque
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <Money cents={g.savedCents} animate className="text-lg font-semibold text-fg" />
            {g.targetCents !== null ? (
              <span className="text-base text-fg-muted">
                sur <Money cents={g.targetCents} />
                {g.targetSource === "mortgage_privilege" ? " (privilège de l'année)" : ""}
              </span>
            ) : null}
          </p>
          {g.targetCents ? (
            <ProgressBar
              value={g.savedCents}
              max={g.targetCents}
              tone="accent"
              label={`${g.name} : ${Math.round((g.progress ?? 0) * 100)} % de la cible`}
              valueText={`${formatMoney(g.savedCents)} sur ${formatMoney(g.targetCents)}`}
            />
          ) : null}
          <p className="text-sm text-fg-muted">
            {g.reached ? (
              "Objectif atteint."
            ) : (
              <>
                {g.remainingCents !== null ? (
                  <>
                    Reste <Money cents={g.remainingCents} />
                  </>
                ) : (
                  "Sans cible"
                )}
                {g.targetDate ? (
                  <span className={g.overdue ? "text-warning" : undefined}>
                    {" "}
                    · {g.overdue ? `échéance dépassée (${fmtDate(g.targetDate)})` : `d'ici le ${fmtDate(g.targetDate)}`}
                  </span>
                ) : null}
              </>
            )}
          </p>
          {g.suggestedMonthlyCents ? (
            <p className="text-sm text-fg-subtle">
              Pour y arriver : <Money cents={g.suggestedMonthlyCents} className="text-fg-muted" /> par mois
              {g.monthsLeft ? ` pendant ${g.monthsLeft} mois` : ""}
            </p>
          ) : null}
        </div>
      )}

      {isMortgage && g.mortgage?.note ? (
        <p className="text-sm text-fg-subtle">
          La progression suit les remboursements anticipés faits cette année de privilège (jusqu&apos;au{" "}
          {fmtDate(g.mortgage.privilege?.yearEnd)}, {relativeFr(g.mortgage.privilege!.yearEnd, today)}).
          {g.mortgage.setAsideCents > 0 ? (
            <>
              {" "}
              Mis de côté pour le prochain : <Money cents={g.mortgage.setAsideCents} />.
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        {contributors.length ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <AvatarStack
              people={contributors.map((m) => ({ name: m.name, tone: toneForMember(memberIds, m.userId).key }))}
              size="sm"
            />
            <span className="min-w-0 truncate text-sm text-fg-muted">
              {contributors.map((m, i) => (
                <span key={m.userId ?? i}>
                  {i ? " · " : ""}
                  {m.isMe ? "Toi" : m.name} <Money cents={m.savedCents} round />
                </span>
              ))}
            </span>
          </div>
        ) : (
          <span className="text-sm text-fg-subtle">{isMortgage ? "Aucun remboursement cette année." : "Aucun montant encore."}</span>
        )}
        <div className="flex gap-2">
          {isMortgage ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/condo/hypotheque">Hypothèque</Link>
            </Button>
          ) : null}
          <Button size="sm" onClick={onContribute}>
            <Plus aria-hidden />
            {isMortgage ? "Mettre de côté" : "Ajouter un montant"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
