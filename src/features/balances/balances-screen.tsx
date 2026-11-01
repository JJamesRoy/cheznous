"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/shell";
import {
  Avatar,
  Button,
  ChipGroup,
  DateInput,
  Field,
  Input,
  ListGroup,
  Money,
  MoneyInput,
  PullToRefresh,
  Row,
  SectionHeader,
  SegmentedControl,
  Sheet,
  SheetFooter,
  Skeleton,
  SlideToConfirm,
  toast,
} from "@/components/ui";
import { formatDateFr, formatDateShortFr } from "@/domain/dates";
import { ApiError, callOp, type OpOutput } from "@/lib/data/api";
import { newIdempotencyKey } from "@/lib/data/offline-queue";
import { useOp, useOpMutation } from "@/lib/data/query";
import { cn } from "@/lib/ui/cn";
import { formatMoney } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/haptics";
import { toneForMember, usePersonTone } from "@/lib/ui/people";
import { usePrivacy } from "@/lib/ui/privacy";
import { useMembers, useSession } from "@/features/app/session";
import { BalanceSentence } from "./balance-sentence";
import { MonthLanes } from "./month-lanes";

type Balances = OpOutput<"balances.get">;
type Activity = Balances["activity"][number];

const ease = [0.23, 1, 0.32, 1] as const;

export function BalancesScreen() {
  const [limit, setLimit] = useState(30);
  const q = useOp("balances.get", { activityLimit: limit }, { placeholderData: (prev) => prev });
  const dash = useOp("dashboard.get", {});
  const qc = useQueryClient();
  const { partner } = useMembers();
  // Kept here (not in <Settle>) so the undo survives the settle card leaving the screen.
  const [justSettled, setJustSettled] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Balances" />
      <PullToRefresh onRefresh={() => qc.invalidateQueries({ queryKey: ["op"] })}>
        {q.data ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-10">
            <div className="flex min-w-0 flex-col gap-8">
              <Hero data={q.data} justSettled={justSettled} onUndone={() => setJustSettled(null)} />
              {partner ? <Settle data={q.data} onSettled={setJustSettled} /> : null}
              <ActivityList data={q.data} onMore={() => setLimit((l) => l + 50)} loadingMore={q.isFetching && q.data.activity.length < limit && q.data.activityCount > q.data.activity.length} />
            </div>
            <div className="flex min-w-0 flex-col gap-8">
              {dash.data ? <MonthLanes lanes={dash.data.lanes} /> : <Skeleton shape="card" className="h-[284px] w-full" />}
              <JointAccount />
            </div>
          </div>
        ) : q.error ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-card bg-surface p-5 text-base text-fg-muted">
            {q.error.isNetwork ? "Hors ligne : les balances n'ont pas encore été chargées sur cet appareil." : q.error.message}
            <Button size="sm" onClick={() => q.refetch()}>
              Réessayer
            </Button>
          </div>
        ) : (
          <BalancesSkeleton />
        )}
      </PullToRefresh>
    </>
  );
}

function Hero({ data, justSettled, onUndone }: { data: Balances; justSettled: string | null; onUndone: () => void }) {
  const { partner } = useMembers();
  const qc = useQueryClient();
  const [undoing, setUndoing] = useState(false);
  async function undo() {
    if (!justSettled) return;
    setUndoing(true);
    try {
      await callOp("settlements.delete", { id: justSettled });
      onUndone();
      await qc.invalidateQueries({ queryKey: ["op"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Impossible d'annuler le règlement.");
    } finally {
      setUndoing(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <BalanceSentence kind={data.me.kind as "owed" | "owes" | "even"} amountCents={data.me.amountCents} partnerName={data.partner?.name ?? null} solo={!partner} as="h2" />
      <p className="text-sm text-fg-subtle">
        {data.lastSettlement ? (
          <>
            Dernier règlement : <Money cents={data.lastSettlement.amountCents} className="text-fg-muted" /> le {formatDateFr(data.lastSettlement.settledOn)}
            {justSettled && data.lastSettlement.id === justSettled ? (
              <>
                {" · "}
                <button type="button" onClick={undo} disabled={undoing} className="-my-3 inline-flex min-h-11 items-center font-medium text-fg underline-offset-4 hover:underline md:min-h-8">
                  Annuler ce règlement
                </button>
              </>
            ) : null}
          </>
        ) : partner ? (
          "Aucun règlement enregistré pour l'instant."
        ) : (
          "Invite ton/ta partenaire pour partager les dépenses."
        )}
      </p>
    </div>
  );
}

// ─── Régler ─────────────────────────────────────────────────────────────────

function Settle({ data, onSettled }: { data: Balances; onSettled: (id: string | null) => void }) {
  const { partner } = useMembers();
  const { masked: hidden } = usePrivacy();
  const qc = useQueryClient();
  const [key, setKey] = useState(newIdempotencyKey);
  const [attempt, setAttempt] = useState(0);
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const [cents, setCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const even = data.me.kind === "even";
  const amount = custom && cents ? cents : data.me.amountCents;
  const iOwe = data.me.kind === "owes";
  const name = partner?.displayName ?? "";

  async function confirm() {
    setError(null);
    if (custom && (!cents || cents <= 0)) {
      setError("Entre un montant plus grand que zéro.");
      throw new Error("invalid");
    }
    try {
      const res = await callOp("settlements.create", { ...(custom && cents ? { amount: { cents } } : {}), confirm: true, idempotencyKey: key });
      haptic("success");
      onSettled(res.settlementId);
      await qc.invalidateQueries({ queryKey: ["op"] });
      // Fresh key and a fresh slider for the next (partial) settlement.
      window.setTimeout(() => {
        setKey(newIdempotencyKey());
        setAttempt((a) => a + 1);
        setCustom(false);
        setText("");
        setCents(null);
      }, 900);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Le règlement n'a pas pu être enregistré.");
      throw e;
    }
  }

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {!even ? (
        <m.section
          key="settle"
          aria-label="Régler"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.2 } }}
          transition={{ duration: 0.32, ease }}
          className="flex flex-col gap-3 rounded-card bg-surface p-4 md:p-5"
        >
          <p className="text-base text-fg-muted">
            {iOwe ? `Enregistre le virement que tu fais à ${name} (Interac, comptant…).` : `Enregistre le virement reçu de ${name}.`}
          </p>
          <SlideToConfirm
            key={attempt}
            label={hidden ? "Glisse pour régler" : `Glisse pour régler ${formatMoney(amount)}`}
            pendingLabel="Enregistrement…"
            confirmedLabel="Réglé"
            disabled={custom && !cents}
            onConfirm={confirm}
          />
          {custom ? (
            <Field label="Autre montant" hint={`Règlement partiel : le reste demeure dû.`}>
              <MoneyInput
                value={text}
                autoFocus
                onValueChange={(t, c) => {
                  setText(t);
                  setCents(c);
                }}
              />
            </Field>
          ) : (
            <button type="button" onClick={() => setCustom(true)} className="-mx-2 inline-flex min-h-11 items-center self-start rounded-control px-2 text-sm text-fg-muted hover:text-fg md:min-h-9">
              Autre montant
            </button>
          )}
          {error ? (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          ) : null}
        </m.section>
      ) : null}
    </AnimatePresence>
  );
}

// ─── Depuis votre dernier règlement ─────────────────────────────────────────

function ActivityList({ data, onMore, loadingMore }: { data: Balances; onMore: () => void; loadingMore: boolean }) {
  const { partner } = useMembers();
  if (!partner) return null;
  return (
    <section aria-labelledby="activity-title" className="flex flex-col gap-3">
      <SectionHeader
        title={<span id="activity-title">Depuis votre dernier règlement</span>}
        description={data.activityCount ? `${data.activityCount} ${data.activityCount > 1 ? "mouvements" : "mouvement"}` : undefined}
      />
      {data.activity.length === 0 ? (
        <p className="rounded-card bg-surface px-4 py-5 text-base text-fg-muted">Aucun mouvement depuis le dernier règlement.</p>
      ) : (
        <ListGroup as="ul" aria-label="Mouvements">
          {data.activity.map((a) => (
            <li key={`${a.kind}:${a.id}`}>
              <ActivityRow a={a} partnerName={partner.displayName} />
            </li>
          ))}
        </ListGroup>
      )}
      {data.activityCount > data.activity.length ? (
        <Button variant="ghost" className="self-center" onClick={onMore} loading={loadingMore}>
          Afficher plus
        </Button>
      ) : null}
    </section>
  );
}

function ActivityRow({ a, partnerName }: { a: Activity; partnerName: string }) {
  const session = useSession();
  const date = a.date === session.today ? "Aujourd'hui" : formatDateShortFr(a.date);
  const effect = (
    <span className="flex flex-col items-end">
      {a.effectCents === 0 ? (
        <span className="text-sm text-fg-subtle">Sans effet</span>
      ) : (
        <>
          <Money cents={a.effectCents} sign className={cn("text-base", a.effectCents > 0 ? "text-accent-ink" : "text-fg")} />
          <span className="text-xs text-fg-subtle">{a.effectCents > 0 ? "pour toi" : `pour ${partnerName}`}</span>
        </>
      )}
    </span>
  );
  const description = (
    <>
      {date}
      {a.kind === "expense" ? (
        <>
          {" · "}
          <Money cents={a.amountCents} />
        </>
      ) : null}
    </>
  );
  if (a.kind === "expense") return <Row href={`/depenses?d=${a.id}`} title={a.title} description={description} trailing={effect} chevron={false} />;
  return <Row title={a.title} description={description} trailing={effect} />;
}

// ─── Compte commun ──────────────────────────────────────────────────────────

type Period = "month" | "year" | "all";

function JointAccount() {
  const session = useSession();
  const { joint } = useMembers();
  const [period, setPeriod] = useState<Period>("year");
  const [open, setOpen] = useState(false);
  const range =
    period === "month"
      ? { from: `${session.month}-01`, to: session.today }
      : period === "year"
        ? { from: `${session.today.slice(0, 4)}-01-01`, to: session.today }
        : {};
  const q = useOp("contributions.summary", range, { placeholderData: (p) => p });

  return (
    <section aria-labelledby="joint-title" className="flex flex-col gap-3">
      <SectionHeader
        title={<span id="joint-title">{joint.name || "Compte commun"}</span>}
        action={
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Plus aria-hidden /> Contribution
          </Button>
        }
      />
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 md:p-5">
        <SegmentedControl
          aria-label="Période"
          size="sm"
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: "month", label: "Ce mois-ci" },
            { value: "year", label: "Cette année" },
            { value: "all", label: "Tout" },
          ]}
        />
        {q.data ? (
          q.data.totalCents === 0 ? (
            <div className="flex flex-col items-start gap-3 py-1">
              <p className="text-base text-fg-muted">Aucune contribution pour cette période.</p>
              <Button variant="primary" onClick={() => setOpen(true)}>
                Ajouter une contribution
              </Button>
            </div>
          ) : (
            <>
              <p className="text-base text-fg-muted">
                <Money cents={q.data.totalCents} className="text-lg font-semibold text-fg" /> versés au compte
              </p>
              <ul className="flex flex-col gap-4">
                {q.data.members.map((mem) => (
                  <ContributionLane key={mem.userId} m={mem} />
                ))}
              </ul>
            </>
          )
        ) : q.error ? (
          <p role="alert" className="text-sm text-negative">
            {q.error.message}
          </p>
        ) : (
          <Skeleton className="h-28 w-full" />
        )}
        <p className="text-sm text-fg-subtle">Les dépenses payées avec le compte commun ne créent aucune dette entre vous.</p>
      </div>
      <ContributionSheet open={open} onOpenChange={setOpen} />
    </section>
  );
}

function ContributionLane({ m: mem }: { m: OpOutput<"contributions.summary">["members"][number] }) {
  const tone = usePersonTone(mem.userId);
  const session = useSession();
  const isMe = mem.userId === session.user.id;
  const actual = Math.min(1, mem.actualBp / 10000);
  const target = Math.min(1, mem.targetBp / 10000);
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Avatar name={mem.name} size="sm" tone={tone.key} decorative />
        <span className="min-w-0 flex-1 truncate text-base text-fg">{isMe ? "Moi" : mem.name}</span>
        <Money cents={mem.contributedCents} className="text-base font-medium text-fg" />
      </div>
      <div className="relative h-2.5" aria-hidden>
        <div className="absolute inset-0 overflow-hidden rounded-full bg-track">
          <div className={cn("h-full w-full rounded-full transition-transform duration-[320ms] ease-snappy", tone.solid)} style={{ transform: `translateX(${(actual - 1) * 100}%)` }} />
        </div>
        <span className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-fg" style={{ left: `${target * 100}%` }} />
      </div>
      <span className="text-sm text-fg-subtle">
        {Math.round(mem.actualBp / 100)} % des versements · cible {Math.round(mem.targetBp / 100)} %
      </span>
    </li>
  );
}

function ContributionSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Contribution au compte commun">
      <ContributionForm onDone={() => onOpenChange(false)} />
    </Sheet>
  );
}

function ContributionForm({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const { me, partner, members } = useMembers();
  const ids = members.map((x) => x.userId);
  const [key] = useState(newIdempotencyKey);
  const [text, setText] = useState("");
  const [cents, setCents] = useState<number | null>(null);
  const [who, setWho] = useState(me.userId);
  const [date, setDate] = useState(session.today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useOpMutation("contributions.create", {
    onSuccess: () => {
      haptic("success");
      onDone();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!cents || cents <= 0) return setError("Entre un montant.");
        create.mutate({ amount: { cents }, member: who, contributedOn: date, note: note.trim() || undefined, idempotencyKey: key });
      }}
    >
      <Field label="Montant" hideLabel className="items-center">
        <MoneyInput
          size="lg"
          autoFocus
          value={text}
          onValueChange={(t, c) => {
            setText(t);
            setCents(c);
          }}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Versé par</span>
        <ChipGroup
          aria-label="Versé par"
          value={who}
          onValueChange={setWho}
          options={[
            { value: me.userId, label: "Moi", leading: <Avatar name={me.displayName} size="sm" tone={toneForMember(ids, me.userId).key} className="-ml-2" decorative /> },
            ...(partner ? [{ value: partner.userId, label: partner.displayName, leading: <Avatar name={partner.displayName} size="sm" tone={toneForMember(ids, partner.userId).key} className="-ml-2" decorative /> }] : []),
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date">
          <DateInput value={date} onValueChange={(v) => setDate(v || session.today)} />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif" maxLength={300} />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
      <SheetFooter>
        <Button type="submit" variant="primary" size="lg" loading={create.isPending}>
          Ajouter
        </Button>
      </SheetFooter>
    </form>
  );
}

function BalancesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-x-10" aria-busy aria-label="Chargement des balances">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[38px] w-4/5 md:h-11" />
          <Skeleton className="h-[18px] w-56" />
        </div>
        <Skeleton shape="card" className="h-[150px] w-full" />
        <Skeleton shape="card" className="h-[260px] w-full" />
      </div>
      <div className="flex flex-col gap-8">
        <Skeleton shape="card" className="h-[284px] w-full" />
      </div>
    </div>
  );
}
