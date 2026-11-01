"use client";

import { useState } from "react";
import { Avatar, Button, DateInput, Field, Input, SegmentedControl } from "@/components/ui";
import { useMembers, useSession } from "@/features/app/session";
import { InviteLink } from "@/features/onboarding/invite-link";
import { RatioEditor } from "@/features/onboarding/ratio-editor";
import { useOpMutation } from "@/lib/data/query";
import { formatDateFr } from "@/domain/dates";
import { haptic } from "@/lib/ui/haptics";
import { toneForMember } from "@/lib/ui/people";
import { useAvatarUrl } from "./avatar-url";
import { InlineError, Panel, SettingsSection } from "./section";

// ─── Foyer ───────────────────────────────────────────────────────────────────

export function HouseholdSection() {
  const { household } = useSession();
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? household.name;
  const rename = useOpMutation("household.updateSettings", {
    onSuccess: () => {
      setDraft(null);
      haptic("success");
    },
  });
  const week = useOpMutation("household.updateSettings");
  const dirty = draft !== null && draft.trim() !== household.name;
  const [emptyError, setEmptyError] = useState<string | null>(null);
  const weekStart = week.isPending && week.variables?.weekStart !== undefined ? week.variables.weekStart : household.weekStart;

  return (
    <SettingsSection id="foyer" title="Foyer" description="Le nom que vous voyez tous les deux, et le début de la semaine pour les tâches et le budget.">
      <Panel>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setEmptyError("Donne un nom à ton foyer.");
            setEmptyError(null);
            if (dirty) rename.mutate({ name: name.trim() });
          }}
        >
          <Field label="Nom du foyer" className="flex-1" error={emptyError ?? rename.error?.message}>
            <Input value={name} onChange={(e) => setDraft(e.target.value)} maxLength={80} />
          </Field>
          {dirty || rename.isPending ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  setEmptyError(null);
                }}
                className="flex-1 sm:flex-none"
              >
                Annuler
              </Button>
              <Button type="submit" variant="primary" loading={rename.isPending} className="flex-1 sm:flex-none">
                Enregistrer
              </Button>
            </div>
          ) : null}
        </form>
        <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4" id="semaine">
          <span className="text-sm font-medium text-fg">
            La semaine commence le
          </span>
          <SegmentedControl
            aria-label="La semaine commence le"
            value={String(weekStart) as "0" | "1"}
            onValueChange={(v) => week.mutate({ weekStart: Number(v) })}
            options={[
              { value: "0", label: "Dimanche" },
              { value: "1", label: "Lundi" },
            ]}
            className="sm:max-w-xs"
          />
          {week.error ? <InlineError>{week.error.message}</InlineError> : null}
        </div>
      </Panel>
    </SettingsSection>
  );
}

// ─── Partenaire ──────────────────────────────────────────────────────────────

export function PartnerSection() {
  const { household } = useSession();
  const { partner, members } = useMembers();
  const ids = members.map((m) => m.userId);
  return (
    <SettingsSection
      id="partenaire"
      title="Partenaire"
      description={partner ? "Les deux membres du foyer." : "Invite ton ou ta partenaire avec un lien personnel."}
    >
      <Panel padded={false}>
        <ul className="flex flex-col">
          {members.map((m) => (
            <MemberRow key={m.userId} member={m} tone={toneForMember(ids, m.userId).key} />
          ))}
        </ul>
      </Panel>
      {!partner ? (
        <Panel>
          <InviteLink householdId={household.id} householdName={household.name} />
        </Panel>
      ) : null}
    </SettingsSection>
  );
}

function MemberRow({
  member,
  tone,
}: {
  member: { userId: string; displayName: string; avatarPath: string | null; role: string; isMe: boolean };
  tone: "a" | "b" | "joint" | "neutral";
}) {
  const url = useAvatarUrl(member.avatarPath);
  return (
    <li className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 md:px-5 [&+&]:border-t [&+&]:border-border">
      <Avatar name={member.displayName} src={url} tone={tone} size="lg" decorative />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base text-fg">
          {member.displayName}
          {member.isMe ? <span className="text-fg-subtle"> (toi)</span> : null}
        </span>
        <span className="text-sm text-fg-subtle">{member.role === "owner" ? "A créé le foyer" : "Membre"}</span>
      </div>
    </li>
  );
}

// ─── Répartition ─────────────────────────────────────────────────────────────

export function SplitSection() {
  const { household } = useSession();
  const { members, partner } = useMembers();
  const mode = useOpMutation("household.updateSettings");
  const current = mode.isPending && mode.variables?.defaultSplitMode ? mode.variables.defaultSplitMode : household.defaultSplitMode;

  return (
    <SettingsSection
      id="repartition"
      title="Répartition"
      description="Comment les dépenses communes se partagent par défaut. Chaque dépense peut faire exception."
    >
      <Panel>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Répartition par défaut</span>
          <SegmentedControl
            aria-label="Répartition par défaut"
            value={current}
            onValueChange={(v) => mode.mutate({ defaultSplitMode: v })}
            options={[
              { value: "equal", label: "Moitié-moitié" },
              { value: "income", label: "Selon les revenus" },
            ]}
            className="sm:max-w-sm"
          />
          {mode.error ? <InlineError>{mode.error.message}</InlineError> : null}
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <span className="mb-3 block text-sm font-medium">Ratio des revenus</span>
          {partner ? (
            <RatioEditor key={members.map((m) => m.incomeWeightBp).join("-")} members={members} />
          ) : (
            <p className="text-base text-fg-muted">Le ratio se règle quand vous êtes deux dans le foyer. On garde le ratio, jamais vos salaires.</p>
          )}
        </div>
      </Panel>
      <Panel>
        <PayAnchors key={members.map((m) => m.payAnchorDate ?? "").join("|")} />
      </Panel>
    </SettingsSection>
  );
}

function PayAnchors() {
  const { members } = useMembers();
  const { today } = useSession();
  const initial = Object.fromEntries(members.map((m) => [m.userId, m.payAnchorDate ?? ""]));
  const [dates, setDates] = useState<Record<string, string>>(initial);
  const save = useOpMutation("household.updateSettings", { onSuccess: () => haptic("success") });
  const dirty = members.some((m) => (dates[m.userId] ?? "") !== (m.payAnchorDate ?? ""));
  const future = members.some((m) => dates[m.userId] && dates[m.userId] > today);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || future) return;
        save.mutate({ payAnchors: Object.fromEntries(members.map((m) => [m.userId, dates[m.userId] || null])) });
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Jours de paie</span>
        <p className="text-sm text-fg-subtle">Date d&apos;une paie récente (aux deux semaines). Sert à prévoir les prochaines paies dans le budget.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {members.map((m) => (
          <Field
            key={m.userId}
            label={m.isMe ? `${m.displayName} (toi)` : m.displayName}
            hint={m.payAnchorDate && dates[m.userId] === m.payAnchorDate ? `Enregistrée : ${formatDateFr(m.payAnchorDate)}` : undefined}
            error={dates[m.userId] && dates[m.userId] > today ? "Choisis une paie déjà reçue." : undefined}
          >
            <DateInput value={dates[m.userId] ?? ""} max={today} onValueChange={(v) => setDates((d) => ({ ...d, [m.userId]: v }))} />
          </Field>
        ))}
      </div>
      {save.error ? <InlineError>{save.error.message}</InlineError> : null}
      {dirty || save.isPending ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDates(initial)}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={future} loading={save.isPending}>
            Enregistrer les paies
          </Button>
        </div>
      ) : null}
    </form>
  );
}
