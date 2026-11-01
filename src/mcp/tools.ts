import { z } from "zod";
import type { Register } from "./server";
import { execute } from "../server/op";
import * as household from "../server/usecases/household";
import * as expenses from "../server/usecases/expenses";
import * as balances from "../server/usecases/balances";

/**
 * MCP tools. Each tool translates snake_case arguments into a server op input and
 * returns the op's result. No business logic or money math lives here.
 */

const money = z
  .union([z.string().min(1).max(32), z.object({ cents: z.number().int().nonnegative() })])
  .describe('Montant : chaîne décimale en dollars ("85", "85,50", "1 234,56") ou {"cents": 8550}.');
const memberRef = z.string().max(100).describe('« moi », le prénom du partenaire, ou un identifiant de membre.');
const payerRef = z.string().max(100).describe('« moi », le prénom du partenaire, ou « commun » pour le compte commun.');
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
      return { ...r, sum: (await import("../domain/money")).formatMoney(r.sumCents) };
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
}
