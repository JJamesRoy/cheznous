/**
 * Chez Nous — prefill the condo (property, mortgage, recurring bills, appliances, documents)
 * and import the Splitwise history. Idempotent, dry-run by default.
 *
 *   pnpm import:condo                         # dry run: prints the plan, writes import-report.csv
 *   pnpm import:condo --since 2026-10-23      # only lines on/after that date + one opening balance
 *   pnpm import:condo --since 2026-10-23 --apply
 *
 * Options: --data <dir> (default data/import: condo.json + the Splitwise CSVs), --only <sections>
 * (comma list of property,mortgage,projects,recurring,appliances,tasks,documents,splitwise).
 *
 * Everything goes through the app's use cases (src/server) with a USER-scoped Supabase client,
 * so RLS, validation, cents, audit triggers and idempotency apply exactly as in the app.
 * Authentication, in order:
 *   CHEZNOUS_ACCESS_TOKEN                     an access token of the importing member, or
 *   SUPABASE_SECRET_KEY + condo.json importAs a one-time session minted for that member
 *                                             (admin generateLink + verifyOtp; no email is sent).
 * Nothing is ever deleted. Rows created through the MCP are only read (tasks are updated in place).
 * condo.json and the CSVs hold personal data: they live in data/import/, which is git-ignored.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import {
  fmtCents,
  netOf,
  parseSplitwiseExport,
  personFor,
  planLine,
  type Cents,
  type Override,
  type ParsedGroup,
} from "./lib/splitwise";

config({ path: ".env.local", quiet: true });

// ---------------------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = flag("apply");
/** No database at all: plan as if nothing existed yet (Splitwise report is exact, other sections are "create"). */
const OFFLINE = flag("offline");
if (OFFLINE && APPLY) throw new Error("--offline et --apply sont incompatibles.");
const SINCE = opt("since") ?? null;
const DATA_DIR = opt("data") ?? "data/import";
const ONLY = new Set((opt("only") ?? "property,mortgage,projects,recurring,appliances,tasks,documents,splitwise").split(","));
if (SINCE && !/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) throw new Error("--since attend une date AAAA-MM-JJ.");

type Money = { cents: number };
type Seed = {
  householdId: string;
  importAs: string;
  /** Used by --offline only (the live run reads members from the database). */
  members?: { userId: string; displayName: string }[];
  property: Record<string, unknown>;
  mortgage: Record<string, unknown>;
  projects: { name: string; notes?: string }[];
  recurring: {
    kind: "bill" | "expense";
    title: string;
    amount: Money | null;
    category: string;
    frequency: string;
    anchorDate: string;
    installmentDates?: string[];
    payer?: string;
    split?: { mode: string; exact?: Record<string, Money> };
  }[];
  appliances: { name: string; brand?: string; purchasedOn?: string; price?: Money; notes?: string }[];
  taskApplianceLinks: { taskTitle: string; appliance: string }[];
  documents: { title: string; docType: string; driveId: string; documentDate?: string }[];
  splitwise: { groups: { key: string; file: string }[]; expectedNetCents: Record<string, number>; overrides: Override[] };
};

const seed = JSON.parse(readFileSync(join(DATA_DIR, "condo.json"), "utf8")) as Seed;
const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const cents = (v: unknown) => (v && typeof v === "object" && "cents" in v ? (v as Money).cents : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------------------------------------------------------------------------- plan model

type Action = {
  section: string;
  key: string;
  action: "create" | "update" | "skip" | "warn";
  detail: string;
  run?: () => Promise<unknown>;
};
const plan: Action[] = [];
const add = (a: Action) => plan.push(a);

// ---------------------------------------------------------------------------- main

async function main() {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!OFFLINE && (!URL || !PUB)) throw new Error("NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY sont requis.");

  const { createClient } = await import("@supabase/supabase-js");
  const { getTokenSupabase } = await import("../src/lib/supabase/token");
  const { buildCtx } = await import("../src/server/ctx");
  const { execute } = await import("../src/server/op");
  const condo = await import("../src/server/usecases/condo");
  const recurring = await import("../src/server/usecases/recurring");
  const goals = await import("../src/server/usecases/goals");
  const tasks = await import("../src/server/usecases/tasks");
  const expenses = await import("../src/server/usecases/expenses");
  const balances = await import("../src/server/usecases/balances");

  // ---- session (user-scoped: RLS applies)
  type Hh = { id: string; name: string; members: { userId: string; displayName: string }[] };
  let hh: Hh;
  let me: string;
  let run: <T>(op: Parameters<typeof execute>[0], input: unknown) => Promise<T>;
  let importedKeys: () => Promise<Set<string>>;
  if (OFFLINE) {
    if (!seed.members?.length) throw new Error("--offline : ajoute « members » dans condo.json.");
    hh = { id: seed.householdId, name: "(hors ligne)", members: seed.members };
    me = seed.members[0].userId;
    const empty: Record<string, unknown> = {
      "condo.getProperty": { property: null, mortgage: null, message: null },
      "projects.list": { projects: [] },
      "recurring.list": { rules: [] },
      "condo.listAppliances": { appliances: [] },
      "tasks.list": { tasks: [] },
      "condo.listDocuments": { documents: [] },
    };
    run = async <T>(op: Parameters<typeof execute>[0]) => {
      if (op.kind !== "read" || !(op.name in empty)) throw new Error(`hors ligne : ${op.name} indisponible`);
      return empty[op.name] as T;
    };
    importedKeys = async () => new Set();
  } else {
    let token = process.env.CHEZNOUS_ACCESS_TOKEN ?? "";
    if (!token) {
      const secret = process.env.SUPABASE_SECRET_KEY;
      if (!secret) throw new Error("Fournis CHEZNOUS_ACCESS_TOKEN, ou SUPABASE_SECRET_KEY pour ouvrir une session de " + seed.importAs + ".");
      const admin = createClient(URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
      // Guard: never mint a session (generateLink creates missing users!) on the wrong project.
      const found = await admin.from("households").select("id").eq("id", seed.householdId).maybeSingle();
      if (found.error || !found.data) throw new Error(`Le foyer ${seed.householdId} est introuvable sur ${URL} : mauvais projet Supabase ? (${found.error?.message ?? "aucune ligne"})`);
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email: seed.importAs });
      if (link.error || !link.data.properties?.hashed_token) throw new Error(`Session impossible : ${link.error?.message}`);
      const anon = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
      const v = await anon.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
      if (v.error || !v.data.session) throw new Error(`Session impossible : ${v.error?.message}`);
      token = v.data.session.access_token;
    }
    const db = getTokenSupabase(token);
    // Identity for the context; the database still verifies the token on every query (RLS).
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { sub: string; email?: string };
    const ctx = await buildCtx(db, { source: "app", claims: { sub: claims.sub, email: claims.email ?? null } });
    if (!ctx.household || ctx.household.id !== seed.householdId) {
      throw new Error(`Foyer inattendu (${ctx.household?.id ?? "aucun"}) : attendu ${seed.householdId}.`);
    }
    const ctxHh = ctx.household;
    hh = ctxHh;
    me = ctx.userId;
    run = <T>(op: Parameters<typeof execute>[0], input: unknown) => execute(op, ctx, input) as Promise<T>;
    importedKeys = async () => {
      const { data, error } = await db.from("idempotency_keys").select("key").like("key", "import:%");
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((r: { key: string }) => r.key));
    };
  }
  const memberId = (name: string) => {
    const m = hh.members.find((x) => norm(x.displayName) === norm(name) || x.userId === name);
    if (!m) throw new Error(`Membre « ${name} » introuvable.`);
    return m.userId;
  };
  console.log(`Foyer « ${hh.name} » · connecté comme ${hh.members.find((m) => m.userId === me)?.displayName}`);
  console.log(APPLY ? "Mode --apply : les écritures seront faites.\n" : "Mode simulation (dry-run) : rien n'est écrit. Ajoute --apply pour écrire.\n");

  // ===================================================================== 1. property
  type PropertyDto = Awaited<ReturnType<typeof condo.getProperty.run>>;
  const prop = (await run(condo.getProperty, {})) as PropertyDto;
  if (ONLY.has("property")) {
    const p = prop.property;
    const current: Record<string, unknown> = p
      ? {
          postalCode: p.postalCode,
          areaSqft: p.areaSqft,
          purchasePrice: p.purchasePriceCents,
          syndicateName: p.syndicate.name,
          managerName: p.syndicate.managerName,
          managerEmail: p.syndicate.managerEmail,
          managerPhone: p.syndicate.managerPhone,
          agmDate: p.syndicate.agmDate,
          condoFee: p.syndicate.condoFeeCents,
          condoFeeContingency: p.syndicate.condoFeeContingencyCents,
          insurer: p.insurance.insurer,
          insurancePolicyNumber: p.insurance.policyNumber,
          insuranceRenewalOn: p.insurance.renewalOn,
          insurancePremium: p.insurance.premiumCents,
          syndicateDeductible: p.insurance.syndicateDeductibleCents,
          ownerDeductibleCoverage: p.insurance.ownerDeductibleCoverageCents,
          welcomeTax: p.welcomeTax.amountCents,
          welcomeTaxDueOn: p.welcomeTax.dueOn,
          welcomeTaxPaidOn: p.welcomeTax.paidOn,
          purchaseDate: p.purchaseDate,
        }
      : {};
    const patch: Record<string, unknown> = {};
    const changes: string[] = [];
    for (const [k, v] of Object.entries(seed.property)) {
      if (!same(current[k], cents(v))) {
        patch[k] = v;
        changes.push(`${k}: ${JSON.stringify(current[k] ?? null)} → ${JSON.stringify(cents(v))}`);
      }
    }
    if (changes.length === 0) add({ section: "property", key: "import:condo:property", action: "skip", detail: "fiche déjà à jour" });
    else
      add({
        section: "property",
        key: "import:condo:property",
        action: p ? "update" : "create",
        detail: changes.join("; "),
        run: () => run(condo.upsertProperty, patch),
      });
  }

  // ===================================================================== 2. mortgage
  if (ONLY.has("mortgage")) {
    const m = prop.mortgage;
    const desired = seed.mortgage;
    if (!m) {
      add({ section: "mortgage", key: "import:condo:mortgage", action: "create", detail: `${desired.lender} ${fmtCents(cents(desired.originalPrincipal) as number)} $`, run: () => run(condo.upsertMortgage, desired) });
    } else {
      const current: Record<string, unknown> = {
        lender: m.lender,
        originalPrincipal: m.originalPrincipalCents,
        rate: m.ratePct,
        rateType: m.rateType,
        termMonths: m.termMonths,
        amortizationMonths: m.amortizationMonths,
        paymentFrequency: m.paymentFrequency,
        payment: m.paymentCents,
        startDate: m.startDate,
        renewalDate: m.renewalEstimated ? null : m.renewalDate,
        notes: m.notes,
      };
      const patch: Record<string, unknown> = { id: m.id };
      const changes: string[] = [];
      for (const [k, v] of Object.entries(desired)) {
        if (!same(current[k], cents(v))) {
          patch[k] = v;
          changes.push(k === "notes" ? "notes" : `${k}: ${JSON.stringify(current[k] ?? null)} → ${JSON.stringify(cents(v))}`);
        }
      }
      if (!changes.length) add({ section: "mortgage", key: "import:condo:mortgage", action: "skip", detail: "hypothèque déjà à jour" });
      else add({ section: "mortgage", key: "import:condo:mortgage", action: "update", detail: changes.join("; "), run: () => run(condo.upsertMortgage, patch) });
    }
  }

  // ===================================================================== 3. projects
  type ProjectsDto = { projects: { id: string; name: string }[] };
  const projects = (await run(goals.listProjects, { includeArchived: true })) as ProjectsDto;
  if (ONLY.has("projects")) {
    for (const pr of seed.projects) {
      const hit = projects.projects.find((x) => norm(x.name) === norm(pr.name));
      if (hit) add({ section: "projects", key: `import:condo:project:${pr.name}`, action: "skip", detail: `« ${pr.name} » existe` });
      else add({ section: "projects", key: `import:condo:project:${pr.name}`, action: "create", detail: `« ${pr.name} »`, run: () => run(goals.upsertProject, pr) });
    }
  }

  // ===================================================================== 4. recurring
  type RulesDto = { rules: { id: string; kind: string; title: string; amountCents: number | null; category: { name: string } | null; frequency: string; anchorDate: string; installmentDates: string[]; template: unknown }[] };
  const loadRules = async () => (await run(recurring.listRecurring, { includeInactive: true })) as RulesDto;
  const rules = await loadRules();
  if (ONLY.has("recurring")) {
    for (const r of seed.recurring) {
      const split = r.split
        ? { ...r.split, ...(r.split.exact ? { exact: Object.fromEntries(Object.entries(r.split.exact).map(([k, v]) => [memberId(k), v])) } : {}) }
        : undefined;
      const input = {
        kind: r.kind,
        title: r.title,
        amount: r.amount,
        category: r.category,
        frequency: r.frequency,
        anchorDate: r.anchorDate,
        installmentDates: r.installmentDates,
        payer: r.payer ? memberId(r.payer) : undefined,
        split,
        autoCreate: false,
      };
      const hit = rules.rules.find((x) => norm(x.title) === norm(r.title));
      const wanted = {
        kind: r.kind,
        amountCents: r.amount?.cents ?? null,
        category: r.category,
        frequency: r.frequency,
        anchorDate: r.anchorDate,
        installmentDates: r.frequency === "installments" ? [...(r.installmentDates ?? [])].sort() : [],
        template: JSON.parse(JSON.stringify({ payer: input.payer, split })),
      };
      const k = `import:condo:recurring:${r.title}`;
      const label = `${r.title} · ${r.amount ? fmtCents(r.amount.cents) + " $" : "montant ?"} · ${r.frequency} dès ${r.anchorDate}`;
      if (!hit) {
        add({ section: "recurring", key: k, action: "create", detail: label, run: () => run(recurring.upsertRecurring, input) });
        continue;
      }
      const have = {
        kind: hit.kind,
        amountCents: hit.amountCents,
        category: hit.category?.name ?? null,
        frequency: hit.frequency,
        anchorDate: hit.anchorDate,
        installmentDates: hit.installmentDates,
        template: JSON.parse(JSON.stringify(hit.template ?? {})),
      };
      if (same(have, wanted)) add({ section: "recurring", key: k, action: "skip", detail: `${r.title} déjà à jour` });
      else add({ section: "recurring", key: k, action: "update", detail: label, run: () => run(recurring.upsertRecurring, { ...input, id: hit.id }) });
    }
  }

  // ===================================================================== 5. appliances
  type AppliancesDto = { appliances: { id: string; name: string; brand: string | null; purchasedOn: string | null; priceCents: number | null; notes: string | null }[] };
  const loadAppliances = async () => (await run(condo.listAppliances, {})) as AppliancesDto;
  const appliances = await loadAppliances();
  if (ONLY.has("appliances")) {
    for (const a of seed.appliances) {
      const hit = appliances.appliances.find((x) => norm(x.name) === norm(a.name));
      const k = `import:condo:appliance:${a.name}`;
      if (!hit) {
        add({ section: "appliances", key: k, action: "create", detail: a.name, run: () => run(condo.upsertAppliance, a) });
        continue;
      }
      const diff =
        !same(hit.brand, a.brand ?? hit.brand) ||
        !same(hit.purchasedOn, a.purchasedOn ?? hit.purchasedOn) ||
        !same(hit.priceCents, a.price?.cents ?? hit.priceCents) ||
        !same(hit.notes, a.notes ?? hit.notes);
      if (!diff) add({ section: "appliances", key: k, action: "skip", detail: `${a.name} existe` });
      else add({ section: "appliances", key: k, action: "update", detail: a.name, run: () => run(condo.upsertAppliance, { ...a, id: hit.id }) });
    }
  }

  // ===================================================================== 6. tasks ↔ appliances
  if (ONLY.has("tasks")) {
    type TasksDto = { tasks: { id: string; title: string; applianceId: string | null }[] };
    const all = (await run(tasks.listTasks, { scope: "all", limit: 500 })) as TasksDto;
    for (const link of seed.taskApplianceLinks) {
      const re = new RegExp(link.taskTitle, "i");
      const matches = all.tasks.filter((t) => re.test(norm(t.title)) || re.test(t.title));
      const k = `import:condo:task-appliance:${link.appliance}`;
      if (matches.length !== 1) {
        add({ section: "tasks", key: k, action: "warn", detail: `/${link.taskTitle}/ : ${matches.length} tâche(s) trouvée(s), lien ignoré` });
        continue;
      }
      const task = matches[0];
      add({
        section: "tasks",
        key: k,
        action: "update",
        detail: `« ${task.title} » → ${link.appliance}`,
        run: async () => {
          const apps = await loadAppliances();
          const app = apps.appliances.find((x) => norm(x.name) === norm(link.appliance));
          if (!app) throw new Error(`Appareil « ${link.appliance} » introuvable.`);
          if (task.applianceId === app.id) return { skipped: true };
          return run(tasks.updateTask, { id: task.id, applianceId: app.id });
        },
      });
      // Already linked → skip instead of update.
      const app = appliances.appliances.find((x) => norm(x.name) === norm(link.appliance));
      if (app && task.applianceId === app.id) {
        plan.pop();
        add({ section: "tasks", key: k, action: "skip", detail: `« ${task.title} » déjà reliée à ${link.appliance}` });
      }
    }
  }

  // ===================================================================== 7. documents
  type DocsDto = { documents: { id: string; title: string; externalUrl: string | null }[] };
  if (ONLY.has("documents")) {
    const docs = (await run(condo.listDocuments, { limit: 500 })) as DocsDto;
    for (const d of seed.documents) {
      const hit = docs.documents.find((x) => x.externalUrl?.includes(d.driveId));
      const k = `import:condo:document:${d.driveId}`;
      if (hit) add({ section: "documents", key: k, action: "skip", detail: `« ${hit.title} » déjà lié` });
      else
        add({
          section: "documents",
          key: k,
          action: "create",
          detail: `${d.docType} · ${d.title}`,
          run: () => run(condo.addDocument, { title: d.title, docType: d.docType, externalUrl: driveUrl(d.driveId), documentDate: d.documentDate }),
        });
    }
  }

  // ===================================================================== 8. Splitwise
  const report: string[][] = [["date", "groupe", "description", "type", "montant", "payeur", "parts", "catégorie", "règle", "projet", "action", "remarque"]];
  let expectedNet: Record<string, Cents> | null = null;
  if (ONLY.has("splitwise")) {
    const groups: ParsedGroup[] = [];
    for (const g of seed.splitwise.groups) {
      const file = join(DATA_DIR, g.file);
      if (!existsSync(file)) throw new Error(`Fichier manquant : ${file}`);
      const parsed = parseSplitwiseExport(g.key, readFileSync(file, "utf8"));
      const net = netOf(parsed.people, parsed.lines);
      if (!parsed.totals) throw new Error(`${g.key} : ligne « Total balance » absente.`);
      for (const p of parsed.people) {
        if (net[p] !== parsed.totals[p]) throw new Error(`${g.key} : la somme des lignes (${fmtCents(net[p])}) ≠ Total balance (${fmtCents(parsed.totals[p])}) pour ${p}.`);
      }
      console.log(`Splitwise ${g.key} : ${parsed.lines.length} lignes, solde ${parsed.people.map((p) => `${p} ${fmtCents(net[p])}`).join(" / ")} ✓`);
      groups.push(parsed);
    }

    // Person column → member id.
    const people = groups[0].people;
    const idOf = (person: string) => {
      const m = hh.members.find((x) => personFor([person], x.displayName) === person);
      if (!m) throw new Error(`Colonne « ${person} » : aucun membre correspondant.`);
      return m.userId;
    };
    const total = Object.fromEntries(people.map((p) => [p, groups.reduce((s, g) => s + netOf(g.people, g.lines)[p], 0)]));
    expectedNet = Object.fromEntries(people.map((p) => [idOf(p), total[p]]));
    for (const [name, want] of Object.entries(seed.splitwise.expectedNetCents)) {
      const p = people.find((x) => personFor([x], name) === x);
      if (!p || total[p] !== want) throw new Error(`Solde Splitwise combiné inattendu pour ${name} : ${p ? fmtCents(total[p]) : "?"} (attendu ${fmtCents(want)}).`);
    }
    console.log(`Solde combiné attendu : ${people.map((p) => `${p} ${fmtCents(total[p])}`).join(" / ")} ✓\n`);

    const done = await importedKeys();

    // Opening balance (--since): one exact-split expense reproducing everything before.
    if (SINCE) {
      const before = groups.flatMap((g) => g.lines.filter((l) => l.date < SINCE));
      const net = netOf(people, before);
      const creditor = people.find((p) => net[p] > 0);
      const debtor = people.find((p) => net[p] < 0);
      for (const l of before) report.push([l.date, l.group, l.description, "solde d'ouverture", fmtCents(l.costCents), "", "", "", "", "", "inclus dans le solde d'ouverture", ""]);
      if (creditor && debtor) {
        const amount = net[creditor];
        const openDate = new Date(Date.parse(SINCE + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10);
        const key = `import:splitwise:opening:${SINCE}`;
        const input = {
          amount: { cents: amount },
          description: "Solde d'ouverture Splitwise",
          spentOn: openDate,
          category: "Divers",
          payer: idOf(creditor),
          split: { mode: "exact" as const, exact: { [idOf(debtor)]: { cents: amount } } },
          notes: `Solde net Splitwise (${groups.map((g) => g.group).join(" + ")}) de tout ce qui précède le ${SINCE} : ${before.length} lignes. ${debtor} doit ${fmtCents(amount)} $ à ${creditor}.`,
          idempotencyKey: key,
        };
        report.push([openDate, "*", "Solde d'ouverture Splitwise", "dépense", fmtCents(amount), creditor, `${debtor} ${fmtCents(amount)}`, "Divers", "opening", "", done.has(key) ? "déjà importé" : "créer", ""]);
        add({
          section: "splitwise",
          key,
          action: done.has(key) ? "skip" : "create",
          detail: `Solde d'ouverture ${openDate} : ${debtor} doit ${fmtCents(amount)} $ à ${creditor} (${before.length} lignes)`,
          run: () => run(expenses.createExpense, input),
        });
      }
    }

    const rulesNow = () => loadRules();
    const lines = groups.flatMap((g) => g.lines.filter((l) => !SINCE || l.date >= SINCE).map((l) => planLine(g.people, l, seed.splitwise.overrides)));
    lines.sort((a, b) => (a.line.date < b.line.date ? -1 : a.line.date > b.line.date ? 1 : 0));
    for (const p of lines) {
      const l = p.line;
      const isDone = done.has(l.key);
      if (p.kind === "skip") {
        report.push([l.date, l.group, l.description, "ignorée", fmtCents(l.costCents), "", "", "", "", "", "ignorée", p.reason]);
        add({ section: "splitwise", key: l.key, action: "warn", detail: `${l.date} ${l.description} : ${p.reason}` });
        continue;
      }
      if (p.kind === "settlement") {
        report.push([l.date, l.group, l.description, "règlement", fmtCents(p.amountCents), p.from, `${p.from} → ${p.to}`, "", p.rule, "", isDone ? "déjà importé" : "créer", p.note ?? ""]);
        add({
          section: "splitwise",
          key: l.key,
          action: isDone ? "skip" : "create",
          detail: `${l.date} règlement ${p.from} → ${p.to} ${fmtCents(p.amountCents)} $${p.note ? ` (${p.note})` : ""}`,
          run: () =>
            run(balances.createSettlement, {
              amount: { cents: p.amountCents },
              from: idOf(p.from),
              to: idOf(p.to),
              settledOn: l.date,
              note: p.note ?? `Importé de Splitwise (${l.group})`,
              confirm: true,
              idempotencyKey: l.key,
            }),
        });
        continue;
      }
      const sharesTxt = Object.entries(p.shares)
        .map(([k, v]) => `${k} ${fmtCents(v)}`)
        .join(" / ");
      report.push([l.date, l.group, l.description, "dépense", fmtCents(l.costCents), p.payer, sharesTxt, p.category, p.rule, p.project ?? "", isDone ? "déjà importé" : "créer", [p.note, ...p.flags].filter(Boolean).join(" · ")]);
      for (const f of p.flags) add({ section: "splitwise", key: `${l.key}:flag`, action: "warn", detail: `${l.date} ${l.description} : ${f}` });
      add({
        section: "splitwise",
        key: l.key,
        action: isDone ? "skip" : "create",
        detail: `${l.date} ${l.description} ${fmtCents(l.costCents)} $ · payé par ${p.payer} · ${sharesTxt} · ${p.category}${p.project ? ` · projet ${p.project}` : ""}`,
        run: async () => {
          let link: { recurringRuleId?: string; recurringOccurrence?: string } = {};
          if (p.recurringTitle) {
            const rule = (await rulesNow()).rules.find((r) => norm(r.title) === norm(p.recurringTitle!));
            if (rule) link = { recurringRuleId: rule.id, recurringOccurrence: p.recurringOccurrence ?? l.date };
          }
          return run(expenses.createExpense, {
            amount: { cents: l.costCents },
            description: l.description,
            spentOn: l.date,
            category: p.category,
            payer: idOf(p.payer),
            split: { mode: "exact", exact: Object.fromEntries(Object.entries(p.shares).map(([k, v]) => [idOf(k), { cents: v }])) },
            project: p.project,
            notes: [`Importé de Splitwise (${l.group})`, p.note].filter(Boolean).join(" · "),
            idempotencyKey: l.key,
            ...link,
          });
        },
      });
    }
    const reportPath = join(DATA_DIR, "import-report.csv");
    writeFileSync(reportPath, report.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n");
    console.log(`Rapport : ${reportPath} (${report.length - 1} lignes)\n`);
  }

  // ---------------------------------------------------------------------------- print plan
  const icon = { create: "+", update: "~", skip: "=", warn: "!" } as const;
  let section = "";
  for (const a of plan) {
    if (a.section !== section) console.log(`\n## ${(section = a.section)}`);
    console.log(`  ${icon[a.action]} ${a.action.padEnd(6)} ${a.detail}`);
  }
  const count = (k: Action["action"]) => plan.filter((a) => a.action === k).length;
  console.log(`\nTotal : ${count("create")} création(s), ${count("update")} modification(s), ${count("skip")} inchangé(s), ${count("warn")} avertissement(s).`);
  console.log("Non fait (manuel) : renouvellement de l'assurance du syndicat (2027-06-05) — l'app n'a pas de date clé libre ; Hydro-Québec — à créer après la 1re facture.");

  if (!APPLY) return;

  // ---------------------------------------------------------------------------- apply
  console.log("\nÉcriture…");
  const failures: string[] = [];
  for (const a of plan) {
    if (!a.run || (a.action !== "create" && a.action !== "update")) continue;
    try {
      const res = (await a.run()) as { replayed?: boolean } | undefined;
      console.log(`  ✓ ${a.section}: ${a.detail}${res?.replayed ? " (déjà fait)" : ""}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${a.section}: ${a.detail} → ${msg}`);
      console.log(`  ✗ ${a.section}: ${a.detail} → ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------- verify
  console.log("\nVérifications :");
  const ok = (cond: boolean, msg: string) => {
    console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
    if (!cond) failures.push(msg);
  };
  if (expectedNet) {
    const b = (await run(balances.getBalances, {})) as { net: { userId: string; netCents: number }[] | Record<string, number>; sentence: string };
    const net: Record<string, number> = Array.isArray(b.net) ? Object.fromEntries(b.net.map((x) => [x.userId, x.netCents])) : b.net;
    ok(Object.entries(expectedNet).every(([id, c]) => net[id] === c), `balance = Splitwise (${b.sentence})`);
  }
  if (ONLY.has("property") || ONLY.has("mortgage")) {
    const p = (await run(condo.getProperty, {})) as PropertyDto;
    ok(p.message === null, "fiche condo : plus de message « ajoute ton hypothèque »");
    ok(p.property?.welcomeTax.amountCents === cents(seed.property.welcomeTax), "taxe de bienvenue");
    const s = (await run(condo.getMortgageSummary, {})) as { mortgage: { paymentCents: number } | null; renewal: unknown; schedule: { next: { date: string; balanceCents: number }[] } | null };
    ok(s.mortgage?.paymentCents === cents(seed.mortgage.payment), "versement hypothécaire");
    ok(!!s.renewal, "date de renouvellement présente");
    const first = s.schedule?.next[0];
    if (first) console.log(`    prochain versement ${first.date}, solde projeté après : ${fmtCents(first.balanceCents)} $`);
  }
  if (ONLY.has("documents")) {
    const docs = (await run(condo.listDocuments, { limit: 500 })) as DocsDto;
    const linked = seed.documents.filter((d) => docs.documents.some((x) => x.externalUrl?.includes(d.driveId))).length;
    ok(linked === seed.documents.length, `${linked}/${seed.documents.length} documents liés`);
  }
  const bills = (await run(recurring.upcomingBills, { days: 60 })) as { items: { title: string; date: string }[] };
  console.log(`  · échéances 60 jours : ${bills.items.map((i) => `${i.date} ${i.title}`).join(" | ")}`);

  if (failures.length) {
    console.log(`\n${failures.length} problème(s) :\n  - ${failures.join("\n  - ")}`);
    process.exitCode = 1;
  } else console.log("\nTerminé. Relance la même commande : elle doit annoncer 0 création et 0 modification.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
