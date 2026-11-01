import type { OpOutput } from "@/lib/data/api";

export type ListKind = "groceries" | "furniture" | "household" | "wishlist" | "custom";
export type ShoppingItem = OpOutput<"shopping.list">["items"][number];
export type ListSummary = OpOutput<"shopping.lists">["lists"][number];

export const LIST_KIND_LABELS: Record<ListKind, string> = {
  groceries: "Épicerie",
  furniture: "Meubles",
  household: "Produits ménagers",
  wishlist: "Souhaits",
  custom: "Autre",
};

export const LIST_KIND_OPTIONS = (Object.keys(LIST_KIND_LABELS) as ListKind[]).map((value) => ({
  value,
  label: LIST_KIND_LABELS[value],
}));

export function listKindLabel(kind: string): string {
  return LIST_KIND_LABELS[kind as ListKind] ?? "Autre";
}

export const PRIORITY_LABELS: Record<0 | 1 | 2, string> = {
  0: "Normale",
  1: "Important",
  2: "Urgent",
};

/** Cents → text for a <MoneyInput> ("12,34"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** "2 × lait", "1,5 × farine", "lait". */
export function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toLocaleString("fr-CA", { maximumFractionDigits: 2 });
}

/** The groceries list, or the first one. */
export function defaultListId(lists: { id: string; kind: string }[]): string | null {
  return (lists.find((l) => l.kind === "groceries") ?? lists[0])?.id ?? null;
}
