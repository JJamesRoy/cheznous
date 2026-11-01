/**
 * DEV ONLY — demo data for local development and screenshots.
 *   pnpm seed:demo     creates two demo users and a filled household
 *   pnpm seed:reset    wipes the local database (supabase db reset)
 * Refuses to run against anything but a local Supabase, or with NODE_ENV=production.
 * Everything goes through the real use cases (same validation, RLS, audit) — no SQL shortcuts.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true, override: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (process.env.NODE_ENV === "production" || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error("seed:demo refuse de s'exécuter hors d'un Supabase local.");
  process.exit(1);
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { getTokenSupabase } = await import("../src/lib/supabase/token");
  const { buildCtx } = await import("../src/server/ctx");
  const { execute } = await import("../src/server/op");
  const household = await import("../src/server/usecases/household");
  const expenses = await import("../src/server/usecases/expenses");
  const budget = await import("../src/server/usecases/budget");
  const shopping = await import("../src/server/usecases/shopping");
  const tasks = await import("../src/server/usecases/tasks");
  const notes = await import("../src/server/usecases/notes");
  const recurring = await import("../src/server/usecases/recurring");
  const condo = await import("../src/server/usecases/condo");
  const goals = await import("../src/server/usecases/goals");
  const { todayIn, addDays, monthOf, addMonths } = await import("../src/domain/dates");

  const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const anon = createClient(URL, KEY, { auth: { persistSession: false } });
  const PASSWORD = "demo-chez-nous";

  async function user(email: string, name: string) {
    let { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) ({ data, error } = await anon.auth.signUp({ email, password: PASSWORD, options: { data: { display_name: name } } }) as never);
    if (error || !data.session) throw new Error(`${email}: ${error?.message}`);
    const db = getTokenSupabase(data.session.access_token);
    const ctx = async () => buildCtx(db, { source: "test", claims: { sub: data.session!.user.id, email } });
    return { id: data.session.user.id, ctx };
  }

  const a = await user("demo.a@chez-nous.local", "Démo A");
  const b = await user("demo.b@chez-nous.local", "Démo B");
  if ((await a.ctx()).household) {
    console.log("Le foyer démo existe déjà. Lance `pnpm seed:reset` pour repartir de zéro.");
    return;
  }
  const run = async <T>(u: typeof a, op: Parameters<typeof execute>[0], input: unknown) => (await execute(op, await u.ctx(), input)) as T;

  await run(a, household.createHousehold, { name: "Démo — foyer", displayName: "Démo A" });
  const inv = await run<{ token: string }>(a, household.createInvitation, {});
  await run(b, household.acceptInvitation, { token: inv.token, displayName: "Démo B" });
  const s = await run<{ household: { members: { userId: string }[] } }>(a, household.getSession, {});
  const [ma, mb] = s.household.members;
  await run(a, household.updateHouseholdSettings, {
    incomeWeightsBp: { [ma.userId]: 5500, [mb.userId]: 4500 },
    defaultSplitMode: "income",
    payAnchors: { [ma.userId]: "2026-10-30", [mb.userId]: "2026-11-06" },
    onboardingStep: "done",
  });

  const t = todayIn("America/Toronto");
  const m = monthOf(t);
  const prev = addMonths(m, -1);
  for (const [cat, amt] of [["Épicerie", "650"], ["Resto", "200"], ["SAQ", "80"], ["Frais de condo", "385"], ["Hypothèque", "2100"], ["Électricité", "90"], ["Internet et cellulaire", "140"], ["Transport", "160"], ["Meubles et déco", "400"]] as const) {
    await run(a, budget.setBudget, { category: cat, amount: amt, fromMonth: prev });
  }
  const exp: [typeof a, string, string, string, string, string?][] = [
    [a, "IGA", "142,37", "Épicerie", `${prev}-04`],
    [b, "Costco", "236,10", "Épicerie", `${prev}-12`],
    [a, "Frais de condo", "385", "Frais de condo", `${prev}-01`, "commun"],
    [b, "Resto Le Vin Papillon", "118,40", "Resto", `${prev}-19`],
    [a, "Hypothèque", "2084,51", "Hypothèque", `${prev}-30`, "commun"],
    [a, "Frais de condo", "385", "Frais de condo", `${m}-01`, "commun"],
    [a, "Métro Verdun", "87,64", "Épicerie", t],
    [b, "SAQ", "42,75", "SAQ", t],
    [a, "BIXI", "15", "Transport", addDays(t, -1) < `${m}-01` ? t : addDays(t, -1)],
    [b, "Structube — tapis", "289", "Meubles et déco", t],
  ];
  for (const [u, desc, amount, category, date, payer] of exp) {
    await run(u, expenses.createExpense, { description: desc, amount, category, spentOn: date, payer: payer ?? "moi" });
  }
  await run(a, expenses.createExpense, { description: "Cadeau (privé)", amount: "60", isPrivate: true, spentOn: t });

  await run(a, recurring.upsertRecurring, { kind: "bill", title: "Hydro-Québec", amount: "92", category: "Électricité", frequency: "bimonthly", anchorDate: addDays(t, 9), payer: "commun" });
  await run(a, recurring.upsertRecurring, { kind: "bill", title: "Taxes municipales (versements)", amount: "1240", category: "Taxes municipales", frequency: "installments", anchorDate: addDays(t, 20), installmentDates: [addDays(t, 20), addDays(t, 110), addDays(t, 200)] });
  await run(a, recurring.upsertRecurring, { kind: "expense", title: "Internet Fizz", amount: "45", category: "Internet et cellulaire", frequency: "monthly", anchorDate: addDays(t, 4), payer: "commun", autoCreate: true });

  for (const line of ["2 lait 3,99", "pain", "œufs 6,49", "bananes"]) await run(b, shopping.addShoppingItem, { list: "Épicerie", line });
  await run(a, shopping.addShoppingItem, { list: "Meubles du condo", name: "Rideaux salon", unitPrice: "150", priority: 1 });
  await run(a, shopping.addShoppingItem, { list: "Meubles du condo", name: "Lampe sur pied", unitPrice: "129" });
  await run(b, shopping.addShoppingItem, { list: "Produits ménagers", name: "Savon à vaisselle" });

  await run(a, tasks.createTask, { title: "Changer le filtre de la hotte", assignee: "Démo B", dueOn: addDays(t, 2), kind: "maintenance", frequency: "quarterly" });
  await run(b, tasks.createTask, { title: "Envoyer la preuve d'assurance au syndicat", assignee: "Démo A", dueOn: addDays(t, 1), priority: 1, checklist: ["Télécharger l'attestation", "Courriel au gestionnaire"] });
  await run(a, tasks.createTask, { title: "Payer la taxe de bienvenue", dueOn: addDays(t, 45), tags: ["condo"] });

  await run(a, notes.createNote, { title: "Contacts du syndicat", bodyMd: "**Gestionnaire** : voir Condo → Syndicat.\n\nAssemblée générale en mai.", pinned: true, tags: ["condo"] });
  await run(b, notes.createNote, { title: "Idées pour le salon", bodyMd: "- Tapis 8×10\n- Rideaux lin\n- Lampe d'appoint", tags: ["déco"] });

  await run(a, condo.upsertProperty, { city: "Montréal", yearBuilt: 1986, ownershipType: "divided", purchaseDate: "2026-10-30", condoFee: "385", condoFeeContingency: "62", welcomeTax: "5400", welcomeTaxDueOn: addDays(t, 75), agmDate: "2027-05-12", insuranceRenewalOn: "2027-10-30" });
  await run(a, condo.upsertMortgage, { lender: "Prêteur démo", originalPrincipal: "380000", rate: "4,59", rateType: "fixed", startDate: "2026-10-30", termYears: 5, amortizationYears: 25, paymentFrequency: "monthly", prepaymentPrivilegePct: 15 });
  await run(a, goals.upsertGoal, { name: "Fonds d'urgence", target: "10000", targetDate: "2027-12-31" });
  await run(a, goals.upsertGoal, { name: "Remboursement anticipé", kind: "mortgage_prepayment" });

  console.log("Foyer démo créé.\n  demo.a@chez-nous.local / demo.b@chez-nous.local — mot de passe : demo-chez-nous");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
