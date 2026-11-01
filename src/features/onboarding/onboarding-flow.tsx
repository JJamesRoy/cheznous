"use client";

import { ArrowLeft, Check } from "lucide-react";
import { m } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Button, Field, Input, SegmentedControl, Skeleton } from "@/components/ui";
import type { OpOutput } from "@/lib/data/api";
import { useOp, useOpMutation } from "@/lib/data/query";
import { haptic } from "@/lib/ui/haptics";
import { cn } from "@/lib/ui/cn";
import { CondoStep } from "./condo-step";
import { InviteLink } from "./invite-link";
import { initialPct, RatioSlider, toWeights } from "./ratio-editor";

type Session = OpOutput<"session.get">;
type Household = NonNullable<Session["household"]>;
export type StepId = "foyer" | "invite" | "ratio" | "condo" | "expense";
type ServerStep = "invite" | "ratio" | "condo" | "expense" | "done";

const STEPS: { id: StepId; label: string }[] = [
  { id: "foyer", label: "Foyer" },
  { id: "invite", label: "Partenaire" },
  { id: "ratio", label: "Répartition" },
  { id: "condo", label: "Condo" },
  { id: "expense", label: "Première dépense" },
];

function stepFromServer(s: Session): StepId | "done" {
  if (!s.household) return "foyer";
  const step = s.household.onboardingStep as ServerStep;
  return step === "done" ? "done" : STEPS.some((x) => x.id === step) ? (step as StepId) : "invite";
}

export function OnboardingFlow() {
  const router = useRouter();
  const [chosen, setChosen] = useState<StepId | null>(null);
  const session = useOp("session.get", {}, { refetchOnMount: "always", refetchInterval: chosen === "invite" ? 10_000 : false });
  // The device cache may hold an older step: decide only from a fresh server answer.
  const derived = session.data && session.isFetchedAfterMount ? stepFromServer(session.data) : null;
  const step: StepId | "done" | null = chosen ?? derived;

  useEffect(() => {
    if (session.error?.code === "UNAUTHENTICATED") router.replace("/connexion?next=%2Fbienvenue");
  }, [session.error, router]);
  useEffect(() => {
    if (!chosen && derived === "done") router.replace("/");
  }, [chosen, derived, router]);

  const persist = useOpMutation("household.updateSettings");

  if (session.error && session.error.code !== "UNAUTHENTICATED") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-base text-fg-muted">{session.error.message}</p>
        <Button variant="secondary" onClick={() => session.refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }
  if (!session.data || !step || step === "done") return <FlowSkeleton />;

  const data = session.data;
  const index = STEPS.findIndex((s) => s.id === step);

  async function go(to: StepId | "done") {
    if (data.household) {
      await persist.mutateAsync({ onboardingStep: to === "foyer" ? "invite" : (to as ServerStep) });
    }
    if (to === "done") return;
    setChosen(to);
    window.scrollTo({ top: 0 });
  }
  const next = () => go(index + 1 < STEPS.length ? STEPS[index + 1].id : "done");
  const back = index > 0 ? () => setChosen(STEPS[index - 1].id) : undefined;

  return (
    <div className="flex flex-col">
      <Progress index={index} />
      <m.div
        key={step}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col"
      >
        {step === "foyer" ? (
          <FoyerStep session={data} onDone={() => setChosen("invite")} />
        ) : step === "invite" ? (
          <InviteStep household={data.household!} onNext={next} onBack={back} />
        ) : step === "ratio" ? (
          <RatioStep household={data.household!} onNext={next} onBack={back} />
        ) : step === "condo" ? (
          <CondoStep onNext={next} onBack={back} />
        ) : (
          <ExpenseStep
            onFinish={async (withExpense) => {
              await go("done");
              haptic("success");
              window.location.assign(withExpense ? "/?ajouter=depense" : "/");
            }}
            onBack={back}
          />
        )}
      </m.div>
      {persist.error ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          {persist.error.message}
        </p>
      ) : null}
    </div>
  );
}

function Progress({ index }: { index: number }) {
  return (
    <div className="mb-8 flex flex-col gap-2.5">
      <p className="text-sm text-fg-muted">
        <span className="num">
          Étape {index + 1} sur {STEPS.length}
        </span>
        <span aria-hidden> · </span>
        {STEPS[index].label}
      </p>
      <ol className="flex gap-1.5" aria-label="Progression">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex-1">
            <span className={cn("block h-1 rounded-full", i <= index ? "bg-fg" : "bg-gray-5")} />
            <span className="sr-only">
              {s.label}
              {i < index ? " (fait)" : i === index ? " (en cours)" : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StepHeading({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <h1 className="text-xl font-semibold text-balance">{title}</h1>
      {description ? <p className="text-base text-pretty text-fg-muted">{description}</p> : null}
    </div>
  );
}

/** Back · Passer · Continuer. Primary is full width on phones. */
export function StepActions({
  onBack,
  onSkip,
  skipLabel = "Passer",
  primary,
}: {
  onBack?: () => void;
  onSkip?: () => Promise<void> | void;
  skipLabel?: string;
  primary: React.ReactNode;
}) {
  const [skipping, setSkipping] = useState(false);
  return (
    <div className="mt-8 flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
      <div className="flex flex-col sm:flex-row">{primary}</div>
      {onSkip ? (
        <Button
          variant="ghost"
          size="lg"
          loading={skipping}
          onClick={async () => {
            setSkipping(true);
            try {
              await onSkip();
            } finally {
              setSkipping(false);
            }
          }}
        >
          {skipLabel}
        </Button>
      ) : null}
      {onBack ? (
        <Button variant="ghost" size="lg" onClick={onBack} className="sm:mr-auto sm:-ml-4">
          <ArrowLeft aria-hidden />
          Retour
        </Button>
      ) : null}
    </div>
  );
}

function PrimaryButton({
  onClick,
  children,
  type = "button",
  variant = "primary",
}: {
  onClick?: () => Promise<void> | void;
  children: React.ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type={type}
      variant={variant}
      size="lg"
      loading={busy}
      onClick={
        onClick
          ? async () => {
              setBusy(true);
              try {
                await onClick();
              } catch {
                // Error is shown by the mutation that failed.
              } finally {
                setBusy(false);
              }
            }
          : undefined
      }
    >
      {children}
    </Button>
  );
}

// ─── (a) Foyer ───────────────────────────────────────────────────────────────

function FoyerStep({ session, onDone }: { session: Session; onDone: () => void }) {
  const existing = session.household;
  const me = existing?.members.find((m) => m.isMe);
  const [name, setName] = useState(existing?.name ?? "");
  const [displayName, setDisplayName] = useState(me?.displayName ?? session.user.displayName ?? "");
  const [errors, setErrors] = useState<{ name?: string; displayName?: string }>({});
  const create = useOpMutation("household.create");
  const rename = useOpMutation("household.updateSettings");
  const profile = useOpMutation("profile.update");
  const busy = create.isPending || rename.isPending || profile.isPending;
  const error = create.error ?? rename.error ?? profile.error;

  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const errs: typeof errors = {};
        if (!displayName.trim()) errs.displayName = "Ton prénom est requis.";
        if (!name.trim()) errs.name = "Donne un nom à ton foyer.";
        setErrors(errs);
        if (errs.name || errs.displayName) return;
        try {
          if (existing) {
            await Promise.all([
              name.trim() !== existing.name ? rename.mutateAsync({ name: name.trim() }) : null,
              displayName.trim() !== me?.displayName ? profile.mutateAsync({ displayName: displayName.trim() }) : null,
            ]);
          } else {
            await create.mutateAsync({ name: name.trim(), displayName: displayName.trim() });
            haptic("success");
          }
          onDone();
        } catch {
          // Shown below.
        }
      }}
    >
      <StepHeading
        title={existing ? "Votre foyer" : "Nommer votre foyer"}
        description="Le foyer regroupe vos dépenses, listes, tâches et le condo. Vous serez deux à le partager."
      />
      <div className="flex flex-col gap-4">
        <Field label="Ton prénom" error={errors.displayName}>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="given-name" maxLength={60} />
        </Field>
        <Field label="Nom du foyer" error={errors.name} hint="Par exemple : Le condo du Plateau. Tu pourras le changer.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus={!existing} />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          {error.code === "ALREADY_MEMBER" ? "Tu fais déjà partie d'un foyer." : error.message}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {existing ? "Continuer" : "Créer le foyer"}
        </Button>
      </div>
      {!existing ? (
        <p className="mt-8 text-sm text-fg-subtle">
          Ton ou ta partenaire a déjà créé le foyer ? Ouvre plutôt le lien d&apos;invitation reçu : tu le rejoindras directement.
        </p>
      ) : null}
    </form>
  );
}

// ─── (b) Invite ──────────────────────────────────────────────────────────────

function InviteStep({ household, onNext, onBack }: { household: Household; onNext: () => Promise<void>; onBack?: () => void }) {
  const partner = household.members.find((m) => !m.isMe);
  if (partner) {
    return (
      <div className="flex flex-col">
        <StepHeading title={`${partner.displayName} a rejoint le foyer`} description="Vous êtes deux. Tout ce que l'un ajoute, l'autre le voit aussitôt." />
        <div className="flex items-center gap-3 rounded-card bg-surface p-4">
          <Avatar name={partner.displayName} size="lg" decorative />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium">{partner.displayName}</span>
            <span className="text-sm text-fg-subtle">Membre de {household.name}</span>
          </div>
          <Check aria-hidden className="size-5 text-fg-muted" />
        </div>
        <StepActions onBack={onBack} primary={<PrimaryButton onClick={onNext}>Continuer</PrimaryButton>} />
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <StepHeading
        title="Invite ton ou ta partenaire"
        description="Envoie-lui ce lien. Après avoir créé son compte, il ou elle rejoindra directement votre foyer."
      />
      <div className="rounded-card bg-surface p-4 md:p-5">
        <InviteLink householdId={household.id} householdName={household.name} />
      </div>
      <p className="mt-3 text-sm text-fg-subtle">Cette page se met à jour dès que ton ou ta partenaire a rejoint le foyer.</p>
      <StepActions
        onBack={onBack}
        primary={
          <PrimaryButton variant="secondary" onClick={onNext}>
            Continuer
          </PrimaryButton>
        }
      />
    </div>
  );
}

// ─── (c) Ratio ───────────────────────────────────────────────────────────────

function RatioStep({ household, onNext, onBack }: { household: Household; onNext: () => Promise<void>; onBack?: () => void }) {
  const [mode, setMode] = useState<"equal" | "income">(household.defaultSplitMode);
  const together = household.members.length >= 2;
  const [pct, setPct] = useState(() => initialPct(household.members));
  const save = useOpMutation("household.updateSettings");

  return (
    <div className="flex flex-col">
      <StepHeading
        title="Votre ratio"
        description="Comment partager les dépenses communes par défaut ? Tu pourras toujours choisir autrement pour une dépense précise."
      />
      <div className="flex flex-col gap-5 rounded-card bg-surface p-4 md:p-5">
        <SegmentedControl
          aria-label="Répartition par défaut"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "equal", label: "Moitié-moitié" },
            { value: "income", label: "Selon les revenus" },
          ]}
        />
        {mode === "income" ? (
          together ? (
            <RatioSlider members={household.members} value={pct} onValueChange={setPct} />
          ) : (
            <p className="text-base text-fg-muted">
              Le ratio se règle quand vous êtes deux dans le foyer : invite ton ou ta partenaire, puis ajuste-le dans Réglages. D&apos;ici là, les
              dépenses se partagent moitié-moitié.
            </p>
          )
        ) : (
          <p className="text-base text-fg-muted">Chaque dépense commune est partagée 50 / 50.</p>
        )}
        <p className="text-sm text-fg-subtle">On garde le ratio, jamais vos salaires.</p>
      </div>
      {save.error ? (
        <p role="alert" className="mt-4 text-sm text-negative">
          {save.error.message}
        </p>
      ) : null}
      <StepActions
        onBack={onBack}
        onSkip={onNext}
        primary={
          <PrimaryButton
            onClick={async () => {
              await save.mutateAsync({
                defaultSplitMode: mode,
                ...(mode === "income" && together ? { incomeWeightsBp: toWeights(household.members, pct) } : {}),
              });
              await onNext();
            }}
          >
            Continuer
          </PrimaryButton>
        }
      />
    </div>
  );
}

// ─── (e) First expense ───────────────────────────────────────────────────────

function ExpenseStep({ onFinish, onBack }: { onFinish: (withExpense: boolean) => Promise<void>; onBack?: () => void }) {
  return (
    <div className="flex flex-col">
      <StepHeading
        title="Première dépense"
        description="L'épicerie de la semaine, la facture d'Hydro, un souper au resto : ajoute-la maintenant, ça prend dix secondes. Le solde entre vous se calcule tout seul."
      />
      <StepActions
        onBack={onBack}
        onSkip={() => onFinish(false)}
        skipLabel="Plus tard"
        primary={<PrimaryButton onClick={() => onFinish(true)}>Ajouter une dépense</PrimaryButton>}
      />
    </div>
  );
}

function FlowSkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <div className="mb-8 flex flex-col gap-2.5">
        <Skeleton className="h-[18px] w-40" />
        <Skeleton className="h-1 w-full" />
      </div>
      <Skeleton className="mb-2 h-[34px] w-64" />
      <Skeleton className="mb-6 h-10 w-full" />
      <Skeleton shape="card" className="h-40 w-full" />
    </div>
  );
}
