import { z } from "zod";
import type { Register } from "./server";
import { execute } from "../server/op";
import * as household from "../server/usecases/household";
import * as expenses from "../server/usecases/expenses";
import * as balances from "../server/usecases/balances";
import * as budget from "../server/usecases/budget";
import * as shopping from "../server/usecases/shopping";
import * as tasks from "../server/usecases/tasks";
import * as notes from "../server/usecases/notes";
import * as recurring from "../server/usecases/recurring";
import * as condo from "../server/usecases/condo";
import * as keydates from "../server/usecases/keydates";
import * as goals from "../server/usecases/goals";
import * as dashboard from "../server/usecases/dashboard";
import { requireHousehold } from "../server/ctx";
import { resolveGoal } from "../server/support";
import { formatMoney } from "../domain/money";

/**
 * MCP tools. Each tool translates snake_case arguments into a server op input and
 * returns the op's result. No business logic or money math lives here.
 */

const money = z
  .union([z.string().min(1).max(32), z.object({ cents: z.number().int().nonnegative() })])
  .describe('Montant : chaîne décimale en dollars ("85", "85,50", "1 234,56") ou {"cents": 8550}.');
const memberRef = z.string().max(100).describe('« moi », le prénom du partenaire, ou un identifiant de membre.');
const payerRef = z.string().max(100).describe('« moi », le prénom du partenaire, ou « commun » pour le compte commun.');
const month = z.string().regex(/^\d{4}-\d{2}$/).describe("Mois AAAA-MM");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date AAAA-MM-JJ (heure de Montréal).");
const idem = z.string().min(8).max(200).describe("Clé d'idempotence : réutilise-la si tu réessaies le même appel.");

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const split = z
  .object({
    mode: z.enum(["equal", "percentage", "exact", "income"]).describe("equal = parts égales, percentage = pourcentages, exact = montants, income = ratio de revenus du foyer"),
    percentages: z.record(z.string(), z.number().min(0).max(100)).optional().describe('Ex. {"moi": 50, "Alex": 50}'),
    exact: z.record(z.string(), money).optional().describe('Ex. {"moi": "30", "Alex": "55"}'),
    participants: z.array(memberRef).optional(),
  })
  .describe("Répartition. Par défaut : le mode du foyer.");

export function registerTools(register: Register) {
  // ------------------------------------------------------------------ context
  register({
    name: "get_household_context",
    title: "Contexte du foyer",
    description:
      "À appeler en premier. Retourne les membres (et qui est « moi »), le compte commun, les catégories, les listes, les projets, la répartition par défaut et la date du jour à Montréal.",
    input: {},
    annotations: READ,
    run: async (ctx) => {
      const s = await execute(household.getSession, ctx, {});
      if (!s.household) return { household: null, message: "Aucun foyer : crée-le dans l'app Chez Nous." };
      return {
        me: s.user,
        household: s.household,
        categories: s.categories?.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
        lists: s.lists,
        projects: s.projects,
        today: s.today,
        budgetMonth: s.month,
      };
    },
  });

  // ------------------------------------------------------------------ expenses
  register({
    name: "list_expenses",
    title: "Lister les dépenses",
    description: "Dépenses filtrées par période, catégorie, payeur, projet ou texte. Inclut tes dépenses privées, jamais celles de ton partenaire.",
    input: {
      from: date.optional(),
      to: date.optional(),
      category: z.string().max(100).optional().describe("Nom (accents ignorés) ou id de catégorie"),
      payer: payerRef.optional(),
      project: z.string().max(100).optional(),
      search: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ,
    run: async (ctx, a) => {
      const r = await execute(expenses.listExpenses, ctx, { ...a, limit: a.limit ?? 50, offset: a.offset ?? 0 });
      return { ...r, sum: formatMoney(r.sumCents) };
    },
  });

  register({
    name: "get_expense",
    title: "Détail d'une dépense",
    description: "Une dépense avec sa répartition et ses remboursements.",
    input: { expense_id: z.string().uuid() },
    annotations: READ,
    run: async (ctx, a) => execute(expenses.getExpense, ctx, { id: a.expense_id }),
  });

  register({
    name: "create_expense",
    title: "Ajouter une dépense",
    description:
      "Crée une dépense partagée (ou privée). Payeur par défaut : moi. Répartition par défaut : celle du foyer. Utilise idempotency_key pour qu'un nouvel essai ne crée jamais de doublon.",
    input: {
      amount: money,
      description: z.string().min(1).max(140).describe("Commerçant ou description, ex. « Costco »"),
      date: date.optional().describe("Par défaut : aujourd'hui (Montréal)"),
      category: z.string().max(100).optional(),
      payer: payerRef.optional(),
      split: split.optional(),
      private: z.boolean().optional().describe("Privée : visible seulement par toi, hors balances et budgets partagés"),
      notes: z.string().max(2000).optional(),
      project: z.string().max(100).optional(),
      idempotency_key: idem.optional(),
    },
    annotations: WRITE,
    run: async (ctx, a) =>
      execute(expenses.createExpense, ctx, {
        amount: a.amount,
        description: a.description,
        spentOn: a.date,
        category: a.category,
        payer: a.payer,
        split: a.split,
        isPrivate: a.private,
        notes: a.notes,
        project: a.project,
        idempotencyKey: a.idempotency_key,
      }),
  });

  register({
    name: "update_expense",
    title: "Modifier une dépense",
    description: "Modifie les champs fournis; la répartition est recalculée et les balances aussi. Chaque modification est journalisée (avant/après).",
    input: {
      expense_id: z.string().uuid(),
      amount: money.optional(),
      description: z.string().min(1).max(140).optional(),
      date: date.optional(),
      category: z.string().max(100).nullable().optional(),
      payer: payerRef.optional(),
      split: split.optional(),
      notes: z.string().max(2000).nullable().optional(),
      project: z.string().max(100).nullable().optional(),
    },
    annotations: { ...WRITE, idempotentHint: true },
    run: async (ctx, a) => {
      const r = await execute(expenses.updateExpense, ctx, {
        id: a.expense_id,
        amount: a.amount,
        description: a.description,
        spentOn: a.date,
        category: a.category,
        payer: a.payer,
        split: a.split,
        notes: a.notes,
        project: a.project,
      });
      return { expense: r.expense };
    },
  });

  // ------------------------------------------------------------------ balances
  register({
    name: "get_balances",
    title: "Qui doit combien à qui",
    description: "Balance entre les partenaires, la phrase résumé, et les transactions qui la composent depuis le dernier règlement.",
    input: { activity_limit: z.number().int().min(0).max(100).optional() },
    annotations: READ,
    run: async (ctx, a) => execute(balances.getBalances, ctx, { activityLimit: a.activity_limit ?? 20 }),
  });

  register({
    name: "create_settlement",
    title: "Enregistrer un règlement",
    description:
      "Enregistre un paiement entre partenaires (pas une dépense, pas un remboursement de magasin). Sans confirm: true, renvoie seulement un aperçu. Par défaut : le montant total dû, de la personne qui doit vers l'autre.",
    input: {
      amount: money.optional(),
      from: memberRef.optional(),
      to: memberRef.optional(),
      date: date.optional(),
      note: z.string().max(500).optional(),
      confirm: z.boolean().optional().describe("Doit être true pour enregistrer"),
      idempotency_key: idem.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (ctx, a) =>
      execute(balances.createSettlement, ctx, {
        amount: a.amount,
        from: a.from,
        to: a.to,
        settledOn: a.date,
        note: a.note,
        confirm: a.confirm === true,
        idempotencyKey: a.idempotency_key,
      }),
  });

  // ------------------------------------------------------------------ dashboard / budget
  register({
    name: "get_budget",
    title: "Budget du mois",
    description: "Budget d'un mois par catégorie : prévu, dépensé, restant, état (sous / attention / dépassé) et projection de fin de mois. Mois par défaut : le mois courant (Montréal).",
    input: { month: month.optional() },
    annotations: READ,
    run: async (ctx, a) => execute(budget.getBudget, ctx, { month: a.month }),
  });

  register({
    name: "list_budgets",
    title: "Historique des budgets",
    description: "Totaux mensuels dépensés vs budget pour les derniers mois, globalement ou pour une catégorie.",
    input: { months: z.number().int().min(2).max(24).optional(), category: z.string().max(100).optional() },
    annotations: READ,
    run: async (ctx, a) => execute(budget.budgetHistory, ctx, { months: a.months ?? 6, category: a.category }),
  });

  register({
    name: "get_spending_summary",
    title: "Résumé des dépenses",
    description:
      "Dépenses partagées par catégorie sur une période (mois ou dates), avec comparaison optionnelle à une autre période. Ex. « Compare octobre et novembre » : month=2026-11, compare_month=2026-10. « Combien en épicerie ce mois-ci ? » : category=épicerie.",
    input: {
      month: month.optional(),
      from: date.optional(),
      to: date.optional(),
      compare_month: month.optional(),
      compare_from: date.optional(),
      compare_to: date.optional(),
      category: z.string().max(100).optional(),
    },
    annotations: READ,
    run: async (ctx, a) =>
      execute(budget.spendingSummary, ctx, {
        month: a.month,
        from: a.from,
        to: a.to,
        compareMonth: a.compare_month,
        compareFrom: a.compare_from,
        compareTo: a.compare_to,
        category: a.category,
      }),
  });

  register({
    name: "list_recurring_expenses",
    title: "Dépenses récurrentes",
    description: "Dépenses et factures récurrentes (hebdo, aux deux semaines, mensuelle, aux deux mois comme Hydro-Québec, trimestrielle, annuelle, versements à dates fixes) avec leur prochaine échéance.",
    input: { kind: z.enum(["expense", "bill"]).optional() },
    annotations: READ,
    run: async (ctx, a) => execute(recurring.listRecurring, ctx, { kind: a.kind }),
  });

  register({
    name: "list_upcoming_bills",
    title: "Factures à venir",
    description: "Factures et dépenses récurrentes des N prochains jours (30 par défaut), avec montant et date.",
    input: { days: z.number().int().min(1).max(365).optional() },
    annotations: READ,
    run: async (ctx, a) => execute(recurring.upcomingBills, ctx, { days: a.days ?? 30 }),
  });

  // ------------------------------------------------------------------ shopping
  register({
    name: "list_shopping_lists",
    title: "Listes d'achats",
    description: "Toutes les listes (Épicerie, Meubles du condo…) avec le nombre d'articles à acheter et le total estimé.",
    input: {},
    annotations: READ,
    run: async (ctx) => execute(shopping.listShoppingLists, ctx, {}),
  });

  register({
    name: "get_shopping_list",
    title: "Contenu d'une liste",
    description: "Articles d'une liste (nom accents ignorés, ex. « meubles »), total estimé restant et montant réellement dépensé. « Qu'est-ce qu'on doit acheter pour le salon ? » : cherche dans la liste Meubles.",
    input: { list: z.string().max(100), include_purchased: z.boolean().optional() },
    annotations: READ,
    run: async (ctx, a) => execute(shopping.getShoppingList, ctx, { list: a.list, includePurchased: a.include_purchased ?? false }),
  });

  register({
    name: "add_shopping_item",
    title: "Ajouter un article",
    description: "Ajoute un article à une liste. Ex. « Ajoute des rideaux à 150 $ dans la liste Meubles » : list=Meubles, name=Rideaux, unit_price=\"150\".",
    input: {
      list: z.string().max(100),
      name: z.string().min(1).max(120),
      quantity: z.number().positive().max(999).optional(),
      unit_price: money.optional(),
      url: z.string().url().optional(),
      priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe("0 normale, 1 haute, 2 urgente"),
      assignee: memberRef.optional(),
      notes: z.string().max(1000).optional(),
      idempotency_key: idem.optional(),
    },
    annotations: WRITE,
    run: async (ctx, a) =>
      execute(shopping.addShoppingItem, ctx, {
        list: a.list,
        name: a.name,
        quantity: a.quantity,
        unitPrice: a.unit_price,
        url: a.url,
        priority: a.priority,
        assignee: a.assignee,
        notes: a.notes,
        idempotencyKey: a.idempotency_key,
      }),
  });

  register({
    name: "update_shopping_item",
    title: "Modifier un article",
    description: "Modifie un article (nom, quantité, prix, priorité, responsable, liste).",
    input: {
      item_id: z.string().uuid(),
      name: z.string().min(1).max(120).optional(),
      quantity: z.number().positive().max(999).optional(),
      unit_price: money.nullable().optional(),
      priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
      assignee: memberRef.nullable().optional(),
      list: z.string().max(100).optional(),
      notes: z.string().max(1000).nullable().optional(),
    },
    annotations: WRITE,
    run: async (ctx, a) =>
      execute(shopping.updateShoppingItem, ctx, {
        id: a.item_id,
        name: a.name,
        quantity: a.quantity,
        unitPrice: a.unit_price,
        priority: a.priority,
        assignee: a.assignee,
        list: a.list,
        notes: a.notes,
      }),
  });

  register({
    name: "mark_item_purchased",
    title: "Marquer comme acheté",
    description: "Coche un article. Avec create_expense=true (défaut), crée la dépense liée, pré-remplie (quantité × prix, catégorie selon la liste); amount permet de saisir le prix réel.",
    input: {
      item_id: z.string().uuid(),
      create_expense: z.boolean().optional(),
      amount: money.optional(),
      payer: payerRef.optional(),
      split: split.optional(),
      idempotency_key: idem.optional(),
    },
    annotations: WRITE,
    run: async (ctx, a) =>
      execute(shopping.purchaseShoppingItem, ctx, {
        id: a.item_id,
        createExpense: a.create_expense ?? true,
        amount: a.amount,
        payer: a.payer,
        split: a.split,
        idempotencyKey: a.idempotency_key,
      }),
  });

  // ------------------------------------------------------------------ tasks
  register({
    name: "list_tasks",
    title: "Tâches",
    description: "Tâches du foyer. scope=week : cette semaine (et celles en retard); open : toutes les ouvertes; done : terminées.",
    input: { scope: z.enum(["open", "week", "today", "done", "all"]).optional(), assignee: memberRef.optional() },
    annotations: READ,
    run: async (ctx, a) => execute(tasks.listTasks, ctx, { scope: a.scope ?? "open", assignee: a.assignee }),
  });

  register({
    name: "create_task",
    title: "Créer une tâche",
    description: "Crée une tâche avec responsable, échéance, priorité, étiquettes, récurrence et liste de vérification optionnelles.",
    input: {
      title: z.string().min(1).max(160),
      assignee: memberRef.optional(),
      due_on: date.optional(),
      priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
      tags: z.array(z.string().max(40)).max(10).optional(),
      frequency: z.enum(["weekly", "biweekly", "monthly", "bimonthly", "quarterly", "semiannual", "yearly"]).optional(),
      checklist: z.array(z.string().max(160)).max(50).optional(),
      notes: z.string().max(4000).optional(),
      idempotency_key: idem.optional(),
    },
    annotations: WRITE,
    run: async (ctx, a) =>
      execute(tasks.createTask, ctx, {
        title: a.title,
        assignee: a.assignee,
        dueOn: a.due_on,
        priority: a.priority,
        tags: a.tags,
        frequency: a.frequency,
        checklist: a.checklist,
        notes: a.notes,
        idempotencyKey: a.idempotency_key,
      }),
  });

  register({
    name: "update_task",
    title: "Modifier une tâche",
    description: "Modifie titre, responsable, échéance, priorité, étiquettes ou récurrence.",
    input: {
      task_id: z.string().uuid(),
      title: z.string().min(1).max(160).optional(),
      assignee: memberRef.nullable().optional(),
      due_on: date.nullable().optional(),
      priority: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
      tags: z.array(z.string().max(40)).max(10).optional(),
      frequency: z.enum(["weekly", "biweekly", "monthly", "bimonthly", "quarterly", "semiannual", "yearly"]).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
    },
    annotations: WRITE,
    run: async (ctx, a) =>
      execute(tasks.updateTask, ctx, {
        id: a.task_id,
        title: a.title,
        assignee: a.assignee,
        dueOn: a.due_on,
        priority: a.priority,
        tags: a.tags,
        frequency: a.frequency,
        notes: a.notes,
      }),
  });

  register({
    name: "complete_task",
    title: "Terminer une tâche",
    description: "Marque une tâche comme faite. Une tâche récurrente passe à sa prochaine échéance.",
    input: { task_id: z.string().uuid(), idempotency_key: idem.optional() },
    annotations: WRITE,
    run: async (ctx, a) => execute(tasks.completeTask, ctx, { id: a.task_id, idempotencyKey: a.idempotency_key }),
  });

  // ------------------------------------------------------------------ notes
  register({
    name: "search_notes",
    title: "Chercher dans les notes",
    description: "Recherche plein texte en français dans les notes du foyer (et tes notes privées).",
    input: { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).optional() },
    annotations: READ,
    run: async (ctx, a) => execute(notes.searchNotes, ctx, { q: a.query, limit: a.limit ?? 10 }),
  });

  register({
    name: "get_note",
    title: "Lire une note",
    description: "Contenu Markdown complet d'une note et ses pièces jointes.",
    input: { note_id: z.string().uuid() },
    annotations: READ,
    run: async (ctx, a) => execute(notes.getNote, ctx, { id: a.note_id }),
  });

  register({
    name: "create_note",
    title: "Créer une note",
    description: "Crée une note Markdown (partagée par défaut; private=true pour la garder pour toi).",
    input: {
      title: z.string().max(160),
      body: z.string().max(50000).optional(),
      tags: z.array(z.string().max(40)).max(12).optional(),
      pinned: z.boolean().optional(),
      private: z.boolean().optional(),
      idempotency_key: idem.optional(),
    },
    annotations: WRITE,
    run: async (ctx, a) =>
      execute(notes.createNote, ctx, { title: a.title, bodyMd: a.body, tags: a.tags, pinned: a.pinned, isPrivate: a.private, idempotencyKey: a.idempotency_key }),
  });

  register({
    name: "get_household_dashboard",
    title: "Tableau de bord",
    description: "Vue d'ensemble : balance entre partenaires, budget du mois (dépensé, restant, projection), factures à venir, tâches de la semaine, listes et objectifs.",
    input: { upcoming_days: z.number().int().min(7).max(60).optional() },
    annotations: READ,
    run: async (ctx, a) => execute(dashboard.getDashboard, ctx, { upcomingDays: a.upcoming_days ?? 21 }),
  });

  // ------------------------------------------------------------------ condo
  register({
    name: "get_property_info",
    title: "Infos du condo",
    description: "Copropriété : adresse, syndicat et gestionnaire, frais de condo (et part du fonds de prévoyance), assurance, taxe de bienvenue, cotisations spéciales, résumé de l'hypothèque.",
    input: {},
    annotations: READ,
    run: async (ctx) => execute(condo.getProperty, ctx, {}),
  });

  register({
    name: "get_mortgage_summary",
    title: "Résumé de l'hypothèque",
    description:
      "Solde (d'après le dernier relevé du prêteur, sinon estimé), date de renouvellement et jours restants, versements, droit de remboursement anticipé restant cette année. « C'est quand le renouvellement de l'hypothèque ? »",
    input: {},
    annotations: READ,
    run: async (ctx) => execute(condo.getMortgageSummary, ctx, {}),
  });

  register({
    name: "list_property_documents",
    title: "Documents du condo",
    description: "Déclaration de copropriété, règlements, PV d'assemblée, budget du syndicat, attestation, carnet d'entretien, étude du fonds de prévoyance… Fichiers téléversés ou liens Google Drive.",
    input: { doc_type: z.enum(condo.DOC_TYPES).optional() },
    annotations: READ,
    run: async (ctx, a) => execute(condo.listDocuments, ctx, { docType: a.doc_type }),
  });

  register({
    name: "list_maintenance_tasks",
    title: "Entretien",
    description: "Tâches d'entretien à venir (par échéance) et historique des travaux avec coûts.",
    input: { appliance_id: z.string().uuid().optional() },
    annotations: READ,
    run: async (ctx, a) => execute(condo.listMaintenance, ctx, { applianceId: a.appliance_id, historyLimit: 20 }),
  });

  register({
    name: "get_key_dates",
    title: "Dates importantes",
    description: "Renouvellement hypothécaire, anniversaire du privilège de remboursement, assurance, assemblée générale, versements de taxes, taxe de bienvenue, garanties, entretien — sur les N prochains jours.",
    input: { days: z.number().int().min(1).max(730).optional() },
    annotations: READ,
    run: async (ctx, a) => execute(keydates.keyDates, ctx, { days: a.days ?? 120 }),
  });

  // ------------------------------------------------------------------ goals
  register({
    name: "list_goals",
    title: "Objectifs d'épargne",
    description: "Objectifs (fonds d'urgence, remboursement anticipé de l'hypothèque…) avec épargné, progression, contributions par partenaire et montant mensuel suggéré.",
    input: {},
    annotations: READ,
    run: async (ctx) => execute(goals.listGoals, ctx, {}),
  });

  register({
    name: "get_goal_progress",
    title: "Progression d'un objectif",
    description: "Détail d'un objectif (par nom, accents ignorés, ou id) et ses contributions.",
    input: { goal: z.string().max(100) },
    annotations: READ,
    run: async (ctx, a) => {
      const g = await resolveGoal(requireHousehold(ctx), a.goal);
      return execute(goals.getGoal, ctx, { id: g.id });
    },
  });
}
