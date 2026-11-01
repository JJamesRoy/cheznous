"use client";

import { Download, MoreHorizontal, Plus, Printer, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Avatar,
  Button,
  ChipGroup,
  ConfirmDialog,
  DateInput,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  ListGroup,
  Money,
  MoneyInput,
  Select,
  Sheet,
  SheetFooter,
  Skeleton,
  toast,
} from "@/components/ui";
import { formatDateFr } from "@/domain/dates";
import { useMembers, useSession } from "@/features/app/session";
import { callOp, type OpOutput } from "@/lib/data/api";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOp, useOpMutation } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { haptic } from "@/lib/ui/haptics";
import { toneForMember } from "@/lib/ui/people";
import { Card, fmtDate, QueryError, Section } from "./ui";

type Data = OpOutput<"condo.listCapitalContributions">;
type Contribution = Data["contributions"][number];

/**
 * Print stylesheet scoped to this section: only [data-print-area] is printed,
 * in black on white, whatever the theme. That's our PDF export (via the browser).
 */
const PRINT_CSS = `
@media print {
  @page { margin: 16mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  [data-print-area], [data-print-area] * { visibility: visible !important; color: #000 !important; background: transparent !important; box-shadow: none !important; }
  [data-print-area] { position: absolute; inset: 0 auto auto 0; width: 100%; }
  [data-print-area] [data-print-hide] { display: none !important; }
  [data-print-area] li, [data-print-area] tr { break-inside: avoid; }
  [data-print-area] .cn-print-rule { border-color: #ccc !important; }
}`;

export function CapitalSection() {
  const session = useSession();
  const memberIds = session.household.members.map((m) => m.userId);
  const q = useOp("condo.listCapitalContributions", {});
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<Contribution | null>(null);
  const [exporting, setExporting] = useState(false);
  const del = useOpMutation("condo.deleteCapitalContribution");

  async function exportCsv() {
    setExporting(true);
    try {
      const r = await callOp("condo.capitalContributionsCsv", {});
      // BOM so Excel (fr-CA) reads the accents correctly.
      const blob = new Blob(["﻿", r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton shape="card" className="h-[220px]" />
        <Skeleton shape="card" className="h-[260px]" />
      </div>
    );
  }
  if (q.error) return <QueryError error={q.error} onRetry={() => q.refetch()} what="le registre des apports" />;
  const d = q.data;
  const empty = d.contributions.length === 0;

  return (
    <div data-print-area className="flex flex-col gap-8">
      <style>{PRINT_CSS}</style>
      <div className="hidden flex-col gap-1 print:flex">
        <h1 className="text-xl font-semibold">Registre des apports en capital</h1>
        <p className="text-base">
          {session.household.name} · imprimé le {formatDateFr(session.today)}
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-prose text-base text-fg-muted">{d.note}</p>
        {!empty ? (
          <div data-print-hide className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Ajouter un apport
            </Button>
            <Button size="sm" onClick={exportCsv} loading={exporting}>
              <Download aria-hidden />
              Exporter CSV
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              <Printer aria-hidden />
              Imprimer ou enregistrer en PDF
            </Button>
          </div>
        ) : null}
      </div>

      {empty ? (
        <EmptyState
          message="Note qui a mis quoi dans le condo (mise de fonds, notaire, taxe de bienvenue, rénos) et d'où venait l'argent : CELIAPP, RAP, épargne, don."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Ajouter un premier apport
            </Button>
          }
        />
      ) : (
        <>
          <Card as="section" aria-labelledby="cap-total" className="flex flex-col gap-5 p-5">
            <div className="flex flex-col gap-1">
              <h2 id="cap-total" className="text-sm text-fg-muted">
                Total des apports
              </h2>
              <Money cents={d.totalCents} animate className="text-2xl font-semibold text-fg" />
            </div>
            {d.members.length === 2 && d.totalCents > 0 ? <ContributionSplit data={d} memberIds={memberIds} /> : null}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {d.members.map((m) => (
                <MemberTotals key={m.userId} m={m} tone={toneForMember(memberIds, m.userId).key} />
              ))}
            </div>
            {d.ownershipShares ? (
              <div className="cn-print-rule flex flex-col gap-1 border-t border-border pt-4">
                <span className="text-sm text-fg-subtle">Parts de propriété inscrites</span>
                <span className="text-base text-fg">{d.ownershipShares.map((s) => `${s.name} ${s.label}`).join(" · ")}</span>
              </div>
            ) : null}
          </Card>

          <Section title="Tous les apports" id="cap-list">
            <ListGroup as="ul">
              {d.contributions.map((c) => (
                <li key={c.id} className="cn-print-rule flex items-center gap-3 border-b border-border py-2 pl-4 last:border-b-0">
                  <Avatar name={c.member.name} size="md" tone={toneForMember(memberIds, c.member.userId).key} decorative />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base text-fg">{c.kindLabel}</span>
                    <span className="text-sm text-fg-subtle">
                      {[c.sourceLabel, c.member.name, fmtDate(c.contributedOn), c.note].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Money cents={c.amountCents} className="shrink-0 text-base text-fg" />
                  <span data-print-hide>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton label={`Options pour l'apport du ${fmtDate(c.contributedOn)}`} className="mr-1 text-fg-subtle">
                          <MoreHorizontal aria-hidden />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setToDelete(c)}>
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </li>
              ))}
            </ListGroup>
          </Section>
        </>
      )}

      <Sheet open={adding} onOpenChange={setAdding} title="Ajouter un apport" description="Un montant mis dans le condo par l'un de vous.">
        {adding ? <ContributionForm data={d} onDone={() => setAdding(false)} /> : null}
      </Sheet>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Supprimer cet apport ?"
        description={
          toDelete ? (
            <>
              {toDelete.kindLabel} de <Money cents={toDelete.amountCents} /> par {toDelete.member.name}, le {fmtDate(toDelete.contributedOn)}. Il
              disparaîtra du registre pour vous deux.
            </>
          ) : undefined
        }
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await del.mutateAsync({ id: toDelete.id });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

/** Thin two-part bar: who put what share of the total (identity tints, not ownership). */
function ContributionSplit({ data, memberIds }: { data: Data; memberIds: string[] }) {
  const parts = data.members.filter((m) => m.totalCents > 0);
  return (
    <div data-print-hide className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Répartition des apports : ${data.members.map((m) => `${m.name} ${Math.round((m.totalCents / data.totalCents) * 100)} %`).join(", ")}`}
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
      >
        {parts.map((m) => (
          <span
            key={m.userId}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", toneForMember(memberIds, m.userId).solid)}
            style={{ width: `${(m.totalCents / data.totalCents) * 100}%` }}
          />
        ))}
      </div>
      <p className="text-sm text-fg-subtle">Répartition des apports, pas des parts de propriété.</p>
    </div>
  );
}

function MemberTotals({ m, tone }: { m: Data["members"][number]; tone: "a" | "b" | "joint" | "neutral" }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <Avatar name={m.name} size="md" tone={tone} decorative />
        <span className="min-w-0 flex-1 truncate text-base font-medium text-fg">{m.isMe ? `${m.name} (toi)` : m.name}</span>
        <Money cents={m.totalCents} className="text-lg font-semibold text-fg" />
      </div>
      {m.byKind.length ? (
        <dl className="flex flex-col gap-0.5 pl-[42px] text-sm">
          {m.byKind.map((k) => (
            <div key={k.key} className="flex justify-between gap-3">
              <dt className="text-fg-muted">{k.label}</dt>
              <dd>
                <Money cents={k.totalCents} className="text-fg-muted" />
              </dd>
            </div>
          ))}
          <div className="mt-1 text-fg-subtle">
            Sources :{" "}
            {m.bySource.map((s, i) => (
              <span key={s.key}>
                {i ? " · " : ""}
                {s.label} <Money cents={s.totalCents} round />
              </span>
            ))}
          </div>
        </dl>
      ) : (
        <p className="pl-[42px] text-sm text-fg-subtle">Aucun apport inscrit.</p>
      )}
    </div>
  );
}

function ContributionForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const { today } = useSession();
  const { members, me } = useMembers();
  const [key] = useState(newIdempotencyKey);
  const [member, setMember] = useState(me.userId);
  const [kind, setKind] = useState<Contribution["kind"]>("down_payment");
  const [source, setSource] = useState<string>("none");
  const [amount, setAmount] = useState({ text: "", cents: null as number | null });
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useOpMutation("condo.addCapitalContribution");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount.cents) return setError("Entre un montant.");
    setError(null);
    try {
      await add.mutateAsync({
        member,
        kind,
        source: source === "none" ? null : (source as NonNullable<Contribution["source"]>),
        amount: { cents: amount.cents },
        contributedOn: date,
        note: note.trim() || undefined,
        idempotencyKey: key,
      });
      haptic("success");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Qui">
        <ChipGroup
          aria-label="Qui a fait l'apport"
          value={member}
          onValueChange={setMember}
          options={members.map((m) => ({ value: m.userId, label: m.isMe ? "Moi" : m.displayName }))}
        />
      </Field>
      <Field label="Montant" error={error}>
        <MoneyInput value={amount.text} onValueChange={(text, cents) => setAmount({ text, cents })} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={kind} onValueChange={(v) => setKind(v as Contribution["kind"])} options={data.kinds} />
        </Field>
        <Field label="Source des fonds">
          <Select value={source} onValueChange={setSource} options={[...data.sources, { value: "none", label: "Non précisée" }]} />
        </Field>
      </div>
      <Field label="Date">
        <DateInput value={date} onValueChange={setDate} />
      </Field>
      <Field label="Note">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Chèque au notaire" maxLength={500} />
      </Field>
      <SheetFooter>
        <Button type="submit" variant="primary" loading={add.isPending}>
          Ajouter
        </Button>
      </SheetFooter>
    </form>
  );
}
