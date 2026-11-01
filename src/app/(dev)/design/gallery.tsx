"use client";

import {
  Archive,
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Search,
  ShoppingBasket,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/shell/page-header";
import { AssigneePicker } from "@/components/ui/assignee-picker";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { DateInput } from "@/components/ui/date-input";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, MoneyInput } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ListGroup, Row } from "@/components/ui/list";
import { Money } from "@/components/ui/money";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { SectionHeader } from "@/components/ui/section-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Sheet, SheetFooter } from "@/components/ui/sheet";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import { SwipeRow } from "@/components/ui/swipe-row";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast, undoable } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { useTheme, type ThemePreference } from "@/lib/ui/theme";

const PEOPLE = [
  { id: "a", name: "Personne A" },
  { id: "b", name: "Personne B" },
];

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <SectionHeader title={title} />
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={cn("h-10 rounded-control border border-border", className)} />
      <span className="truncate font-mono text-xs text-fg-subtle">{name}</span>
    </div>
  );
}

export function Gallery() {
  const { theme, setTheme } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [amount, setAmount] = useState("85,50");
  const [heroAmount, setHeroAmount] = useState("");
  const [cents, setCents] = useState(123456);
  const [split, setSplit] = useState<"equal" | "percent" | "amount">("equal");
  const [period, setPeriod] = useState<"week" | "month">("month");
  const [payer, setPayer] = useState<"me" | "partner" | "joint">("me");
  const [filter, setFilter] = useState(true);
  const [checked, setChecked] = useState<Record<string, boolean>>({ one: true });
  const [notify, setNotify] = useState(true);
  const [assignee, setAssignee] = useState<string | null>("a");
  const [category, setCategory] = useState<string>("");
  const [date, setDate] = useState("2026-11-01");
  const [loading, setLoading] = useState(false);

  return (
    <AppShell
      user={{ name: "Personne A" }}
      householdName="Foyer démo"
      onQuickAdd={() => setSheetOpen(true)}
    >
      <PageHeader
        title="Système de design"
        description="Chaque primitive, dans les deux thèmes."
        actions={
          <IconButton label="Rechercher" onClick={() => toast("Recherche ouverte")}>
            <Search aria-hidden />
          </IconButton>
        }
      />

      <PullToRefresh onRefresh={() => new Promise((resolve) => setTimeout(resolve, 900))}>
        <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-2">
          <Section title="Thème">
            <SegmentedControl<ThemePreference>
              aria-label="Thème"
              value={theme}
              onValueChange={setTheme}
              options={[
                { value: "light", label: "Clair" },
                { value: "dark", label: "Sombre" },
                { value: "system", label: "Système" },
              ]}
            />
          </Section>

          <Section title="Montant principal">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-fg-muted">Libellé du solde</span>
              <Money cents={cents} animate className="text-display font-semibold" />
              <span className="text-sm text-fg-subtle">Phrase de contexte sous le montant</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setCents((c) => c + 4250)}>
                + 42,50 $
              </Button>
              <Button size="sm" onClick={() => setCents((c) => c - 1999)}>
                − 19,99 $
              </Button>
            </div>
          </Section>

          <Section title="Couleurs">
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
              <Swatch name="bg" className="bg-bg" />
              <Swatch name="bg-subtle" className="bg-bg-subtle" />
              <Swatch name="surface" className="bg-surface" />
              <Swatch name="surface-2" className="bg-surface-2" />
              <Swatch name="track" className="bg-track" />
              <Swatch name="fg" className="bg-fg" />
              <Swatch name="accent" className="bg-accent" />
              <Swatch name="accent-soft" className="bg-accent-soft" />
              <Swatch name="positive" className="bg-positive" />
              <Swatch name="negative" className="bg-negative" />
              <Swatch name="warning" className="bg-warning" />
              <Swatch name="fg-muted" className="bg-fg-muted" />
            </div>
          </Section>

          <Section title="Typographie">
            <div className="flex flex-col gap-1">
              <p className="text-2xl font-semibold">Titre 40</p>
              <p className="text-xl font-semibold">Titre 28</p>
              <p className="text-lg font-semibold">Titre 20</p>
              <p className="text-md">Corps 16</p>
              <p className="text-base">Corps 14 — texte courant</p>
              <p className="text-sm text-fg-muted">Secondaire 13</p>
              <p className="text-xs text-fg-subtle">Métadonnée 12</p>
              <p className="font-mono text-sm text-fg-muted">mono · cn_7f3a9c</p>
            </div>
          </Section>

          <Section title="Boutons">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">Principal</Button>
              <Button>Secondaire</Button>
              <Button variant="ghost">Discret</Button>
              <Button variant="danger-ghost">
                <Trash2 aria-hidden />
                Supprimer
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm">
                Petit
              </Button>
              <Button variant="primary" size="lg">
                Grand
              </Button>
              <Button
                variant="primary"
                loading={loading}
                onClick={() => {
                  setLoading(true);
                  setTimeout(() => setLoading(false), 1200);
                }}
              >
                Enregistrer
              </Button>
              <Button disabled>Désactivé</Button>
              <Tooltip content="Modifier" shortcut={["E"]}>
                <IconButton label="Modifier" variant="secondary">
                  <Pencil aria-hidden />
                </IconButton>
              </Tooltip>
              <IconButton label="Ajouter" variant="primary">
                <Plus aria-hidden />
              </IconButton>
            </div>
          </Section>

          <Section title="Champs">
            <Field label="Description" hint="Visible par vous deux.">
              <Input placeholder="Ex. : libellé" />
            </Field>
            <Field label="Montant" error={amount === "" ? "Entre un montant." : undefined}>
              <MoneyInput value={amount} onValueChange={(text) => setAmount(text)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Catégorie">
                <Select
                  value={category || undefined}
                  onValueChange={setCategory}
                  options={[
                    { value: "a", label: "Option A" },
                    { value: "b", label: "Option B" },
                    { value: "c", label: "Option C" },
                  ]}
                />
              </Field>
              <Field label="Date">
                <DateInput value={date} onValueChange={setDate} />
              </Field>
            </div>
            <Field label="Note">
              <Textarea placeholder="Quelques mots…" rows={2} />
            </Field>
            <Field label="Recherche" hideLabel>
              <Input leading={<Search aria-hidden />} placeholder="Rechercher" type="search" />
            </Field>
          </Section>

          <Section title="Montant (grand)">
            <div className="rounded-card border border-border bg-surface py-6">
              <MoneyInput
                size="lg"
                aria-label="Montant"
                value={heroAmount}
                onValueChange={(text) => setHeroAmount(text)}
              />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-base">
              <Money cents={-4250} sign tone="auto" />
              <Money cents={12000} sign tone="auto" />
              <Money cents={0} />
              <Money cents={98765432} round className="text-fg-muted" />
            </div>
          </Section>

          <Section title="Sélection">
            <SegmentedControl
              aria-label="Partage"
              value={split}
              onValueChange={setSplit}
              options={[
                { value: "equal", label: "Égal" },
                { value: "percent", label: "Pourcentage" },
                { value: "amount", label: "Montants" },
              ]}
            />
            <SegmentedControl
              aria-label="Période"
              size="sm"
              fill={false}
              value={period}
              onValueChange={setPeriod}
              options={[
                { value: "week", label: "Semaine" },
                { value: "month", label: "Mois" },
              ]}
            />
            <ChipGroup
              aria-label="Payé par"
              value={payer}
              onValueChange={setPayer}
              options={[
                { value: "me", label: "Moi" },
                { value: "partner", label: "Personne B" },
                { value: "joint", label: "Compte commun" },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Chip pressed={filter} onClick={() => setFilter((f) => !f)}>
                {filter ? <Check aria-hidden /> : null}
                Filtre
              </Chip>
              <Chip>
                Autre filtre
                <ChevronDown aria-hidden />
              </Chip>
            </div>
          </Section>

          <Section title="Cases et interrupteurs">
            <ListGroup className="px-4">
              {["one", "two", "three"].map((id, index) => (
                <Checkbox
                  key={id}
                  checked={Boolean(checked[id])}
                  onCheckedChange={(value) => setChecked((prev) => ({ ...prev, [id]: value }))}
                  label={`Article ${index + 1}`}
                  description={index === 1 ? "Détail secondaire" : undefined}
                  strikeWhenChecked
                  shape={index === 2 ? "round" : "square"}
                />
              ))}
            </ListGroup>
            <Switch
              checked={notify}
              onCheckedChange={setNotify}
              label="Notifications"
              description="Libellé descriptif de l’option"
            />
            <div className="flex items-center gap-4">
              <AssigneePicker people={PEOPLE} value={assignee} onValueChange={setAssignee} />
              <AssigneePicker people={PEOPLE} value={assignee} onValueChange={setAssignee} showName />
              <Avatar name="Personne A" size="lg" />
              <AvatarStack people={PEOPLE} />
            </div>
          </Section>

          <Section title="Liste">
            <ListGroup>
              <Row
                leading={<ShoppingBasket aria-hidden />}
                title="Titre de la ligne"
                description="Méta · 1 nov."
                trailing={<Money cents={-8550} className="text-base" />}
                onClick={() => toast("Ligne ouverte")}
              />
              <SwipeRow
                leadingActions={[
                  {
                    id: "archive",
                    label: "Archiver",
                    icon: <Archive aria-hidden />,
                    tone: "accent",
                    onAction: () => undoable("Élément archivé", () => toast("Annulé")),
                  },
                ]}
                trailingActions={[
                  {
                    id: "delete",
                    label: "Supprimer",
                    icon: <Trash2 aria-hidden />,
                    tone: "danger",
                    onAction: () => undoable("Élément supprimé", () => toast("Annulé")),
                  },
                  { id: "edit", label: "Modifier", icon: <Pencil aria-hidden />, onAction: () => {} },
                ]}
              >
                <Row
                  leading={<ShoppingBasket aria-hidden />}
                  title="Ligne à balayer"
                  description="Glisse à gauche ou à droite"
                  trailing={<Money cents={12000} className="text-base" />}
                />
              </SwipeRow>
              <Row
                leading={<Avatar name="Personne B" size="md" decorative />}
                title="Ligne avec lien"
                href="/design"
              />
            </ListGroup>
            <EmptyState
              message="Rien ici pour l’instant."
              action={
                <Button variant="primary" size="sm">
                  <Plus aria-hidden />
                  Ajouter
                </Button>
              }
            />
          </Section>

          <Section title="Progression">
            {[
              { label: "Sous le seuil", value: 4100, max: 10000 },
              { label: "Proche du seuil", value: 8800, max: 10000 },
              { label: "Dépassé", value: 11200, max: 10000 },
            ].map((bar) => (
              <div key={bar.label} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between text-base">
                  <span>{bar.label}</span>
                  <span className="text-sm text-fg-muted">
                    <Money cents={bar.value} round /> sur <Money cents={bar.max} round />
                  </span>
                </div>
                <ProgressBar value={bar.value} max={bar.max} label={bar.label} />
              </div>
            ))}
          </Section>

          <Section title="Chargement">
            <ListGroup>
              {[0, 1].map((i) => (
                <div key={i} className="flex min-h-[52px] items-center gap-3 px-4">
                  <Skeleton shape="circle" className="size-8" />
                  <div className="flex flex-1 flex-col">
                    <SkeletonText className="w-2/5" />
                    <SkeletonText size="sm" className="w-1/4" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </ListGroup>
          </Section>

          <Section title="Couches">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setSheetOpen(true)}>Feuille</Button>
              <Button onClick={() => setPanelOpen(true)}>Panneau latéral</Button>
              <Button onClick={() => setConfirmOpen(true)}>Confirmation</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    Menu
                    <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem icon={<Pencil aria-hidden />} shortcut="E">
                    Modifier
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Archive aria-hidden />}>Archiver</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Trash2 aria-hidden />} destructive>
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Popover>
                <PopoverTrigger asChild>
                  <Button>Popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <p className="text-base">Contenu court et utile.</p>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => toast("Élément ajouté")}>
                Toast
              </Button>
              <Button
                variant="ghost"
                onClick={() => undoable("Élément supprimé", () => toast("Suppression annulée"))}
              >
                Toast avec annulation
              </Button>
            </div>
          </Section>

          <Section title="Glisser pour confirmer">
            <SlideToConfirm onConfirm={() => new Promise((resolve) => setTimeout(resolve, 800))} />
          </Section>

          <Section title="Raccourcis">
            <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
              <span className="flex items-center gap-1.5">
                <Kbd>N</Kbd> nouvelle dépense
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd> commandes
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>G</Kbd> puis <Kbd>D</Kbd> accueil
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>?</Kbd> aide
              </span>
            </div>
          </Section>
        </div>
      </PullToRefresh>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Titre de la feuille"
        description="Description courte de l’action."
      >
        <div className="flex flex-col gap-4">
          <MoneyInput
            size="lg"
            aria-label="Montant"
            value={heroAmount}
            onValueChange={(text) => setHeroAmount(text)}
          />
          <Field label="Description">
            <Input placeholder="Ex. : libellé" />
          </Field>
          <Field label="Payé par">
            <ChipGroup
              aria-label="Payé par"
              value={payer}
              onValueChange={setPayer}
              options={[
                { value: "me", label: "Moi" },
                { value: "partner", label: "Personne B" },
                { value: "joint", label: "Compte commun" },
              ]}
            />
          </Field>
        </div>
        <SheetFooter>
          <Button onClick={() => setSheetOpen(false)}>Annuler</Button>
          <Button
            variant="primary"
            onClick={() => {
              setSheetOpen(false);
              undoable("Élément ajouté", () => toast("Ajout annulé"));
            }}
          >
            Ajouter
          </Button>
        </SheetFooter>
      </Sheet>

      <Sheet open={panelOpen} onOpenChange={setPanelOpen} title="Panneau latéral" desktop="panel">
        <ListGroup>
          <Row title="Première ligne" description="Méta" />
          <Row title="Deuxième ligne" description="Méta" />
        </ListGroup>
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Supprimer cet élément ?"
        description="Cette action est définitive."
        confirmLabel="Supprimer"
        destructive
        onConfirm={() => new Promise((resolve) => setTimeout(resolve, 600))}
      />
    </AppShell>
  );
}
