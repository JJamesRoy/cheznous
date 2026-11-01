"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { lineTotalCents, parseItemLine } from "@/domain/shopping";
import { getQueueSnapshot, newIdempotencyKey, runOrQueue, subscribeQueue, type QueuedWrite } from "@/lib/data/offline-queue";
import { usePendingWrites } from "@/lib/data/query";
import type { ShoppingItem } from "./shared";

/**
 * Optimistic layer for the two offline-capable list writes (add a line, check an item).
 *
 * The server data stays the source of truth; this store only remembers what the person just did
 * until the refetched data reflects it, so rows never flicker back. Writes waiting in the offline
 * queue (IndexedDB, survives reloads) are read from the queue itself and flagged
 * « en attente de synchronisation ».
 */

type LocalAdd = { clientId: string; listId: string; line: string; createdAt: number; queued: boolean; settledAt: number | null };
type LocalToggle = { id: string; purchased: boolean; createdAt: number; queued: boolean; settledAt: number | null };
type State = { adds: LocalAdd[]; toggles: Record<string, LocalToggle> };

let state: State = { adds: [], toggles: {} };
const listeners = new Set<() => void>();
const KEEP_AFTER_SETTLE_MS = 15_000;

function setState(next: State) {
  state = next;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getSnapshot = () => state;
const getServerSnapshot = (): State => ({ adds: [], toggles: {} });

function settleAdd(clientId: string) {
  const now = Date.now();
  setState({ ...state, adds: state.adds.map((a) => (a.clientId === clientId && a.settledAt === null ? { ...a, settledAt: now } : a)) });
  setTimeout(() => setState({ ...state, adds: state.adds.filter((a) => a.clientId !== clientId || a.settledAt === null) }), KEEP_AFTER_SETTLE_MS);
}
function settleToggle(id: string, createdAt: number) {
  const cur = state.toggles[id];
  if (!cur || cur.createdAt !== createdAt) return;
  const now = Date.now();
  setState({ ...state, toggles: { ...state.toggles, [id]: { ...cur, settledAt: now } } });
  setTimeout(() => {
    const t = state.toggles[id];
    if (t && t.createdAt === createdAt) {
      const rest = { ...state.toggles };
      delete rest[id];
      setState({ ...state, toggles: rest });
    }
  }, KEEP_AFTER_SETTLE_MS);
}

// When the offline queue replays a write, mark the matching local entry as settled.
if (typeof window !== "undefined") {
  subscribeQueue(() => {
    const queue = getQueueSnapshot();
    const queuedAdds = new Set(queue.filter((w) => w.op === "shopping.addItem").map((w) => (w.input as { clientId?: string }).clientId));
    const queuedToggles = new Set(queue.filter((w) => w.op === "shopping.toggleItem").map((w) => (w.input as { id: string }).id));
    for (const a of state.adds) if (a.queued && a.settledAt === null && !queuedAdds.has(a.clientId)) settleAdd(a.clientId);
    for (const t of Object.values(state.toggles)) if (t.queued && t.settledAt === null && !queuedToggles.has(t.id)) settleToggle(t.id, t.createdAt);
  });
}

async function refresh(qc: QueryClient) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["op", "shopping.list"] }),
    qc.invalidateQueries({ queryKey: ["op", "shopping.lists"] }),
    qc.invalidateQueries({ queryKey: ["op", "dashboard.get"] }),
  ]);
}

/** Add one line ("2 lait 3,99") to a list. Works offline. Throws ApiError on a permanent failure. */
export async function addItemLine(qc: QueryClient, listId: string, line: string) {
  const clientId = crypto.randomUUID();
  setState({ ...state, adds: [...state.adds, { clientId, listId, line, createdAt: Date.now(), queued: false, settledAt: null }] });
  try {
    const r = await runOrQueue("shopping.addItem", { list: listId, line, idempotencyKey: newIdempotencyKey(), clientId });
    if (r.queued) {
      setState({ ...state, adds: state.adds.map((a) => (a.clientId === clientId ? { ...a, queued: true } : a)) });
    } else {
      settleAdd(clientId);
      await refresh(qc);
    }
    return { ...r, clientId };
  } catch (e) {
    setState({ ...state, adds: state.adds.filter((a) => a.clientId !== clientId) });
    throw e;
  }
}

/** Check / uncheck an item. Works offline; optimistic. */
export async function toggleItem(qc: QueryClient, id: string, purchased: boolean) {
  const createdAt = Date.now();
  setState({ ...state, toggles: { ...state.toggles, [id]: { id, purchased, createdAt, queued: false, settledAt: null } } });
  try {
    const r = await runOrQueue("shopping.toggleItem", { id, purchased, idempotencyKey: newIdempotencyKey() });
    if (r.queued) {
      const cur = state.toggles[id];
      if (cur?.createdAt === createdAt) setState({ ...state, toggles: { ...state.toggles, [id]: { ...cur, queued: true } } });
    } else {
      settleToggle(id, createdAt);
      await refresh(qc);
    }
    return r;
  } catch (e) {
    const cur = state.toggles[id];
    if (cur?.createdAt === createdAt) {
      const rest = { ...state.toggles };
      delete rest[id];
      setState({ ...state, toggles: rest });
    }
    throw e;
  }
}

export type ItemSync = "queued" | "saving" | null;
export type ViewItem = ShoppingItem & { sync: ItemSync };

function draftItem(clientId: string, listId: string, line: string, createdAt: number): ShoppingItem {
  let name = line.trim();
  let quantity = 1;
  let unitPriceCents: number | null = null;
  try {
    const p = parseItemLine(line);
    name = p.name;
    quantity = p.quantity;
    unitPriceCents = p.unitPriceCents;
  } catch {
    // The server will reject or normalize it; show the raw line meanwhile.
  }
  const totalCents = unitPriceCents === null ? null : lineTotalCents(quantity, unitPriceCents);
  return {
    id: clientId,
    listId,
    name,
    quantity,
    unitPriceCents,
    unitPrice: null,
    totalCents,
    total: null,
    url: null,
    imageUrl: null,
    category: null,
    priority: 0,
    assignee: null,
    notes: null,
    purchased: false,
    purchasedAt: null,
    purchasedBy: null,
    expenseId: null,
    sort: Number.MAX_SAFE_INTEGER,
    createdAt: new Date(createdAt).toISOString(),
  };
}

type AddInput = { list: string; line?: string; clientId?: string };
type ToggleInput = { id: string; purchased: boolean };

/**
 * Server items for one list merged with what's pending: local adds and checks not yet reflected,
 * and writes waiting in the offline queue.
 */
export function useListItems(listId: string | null, serverItems: ShoppingItem[] | undefined, dataUpdatedAt: number) {
  const local = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const queue = usePendingWrites();

  return useMemo(() => {
    const items: ViewItem[] = (serverItems ?? []).map((i) => ({ ...i, sync: null }));
    const known = new Set(items.map((i) => i.id));
    const queuedIds = new Set<string>();
    const queueToggles = new Map<string, boolean>();

    for (const w of queue as QueuedWrite[]) {
      if (w.op === "shopping.addItem") {
        const input = w.input as AddInput;
        if (!input.clientId) continue;
        queuedIds.add(input.clientId);
        if (input.list === listId && !known.has(input.clientId) && input.line) {
          items.push({ ...draftItem(input.clientId, input.list, input.line, w.queuedAt), sync: "queued" });
          known.add(input.clientId);
        }
      } else if (w.op === "shopping.toggleItem") {
        const input = w.input as ToggleInput;
        queuedIds.add(input.id);
        queueToggles.set(input.id, input.purchased);
      }
    }

    for (const a of local.adds) {
      if (a.listId !== listId || known.has(a.clientId)) continue;
      if (a.settledAt !== null && dataUpdatedAt > a.settledAt) continue;
      items.push({ ...draftItem(a.clientId, a.listId, a.line, a.createdAt), sync: a.queued ? "queued" : "saving" });
      known.add(a.clientId);
    }

    for (const item of items) {
      const t = local.toggles[item.id];
      if (t && (t.settledAt === null || dataUpdatedAt <= t.settledAt)) {
        item.purchased = t.purchased;
      } else if (queueToggles.has(item.id)) {
        item.purchased = queueToggles.get(item.id)!;
      }
      if (queuedIds.has(item.id)) item.sync = "queued";
    }

    const open = items.filter((i) => !i.purchased);
    const purchased = items.filter((i) => i.purchased);
    return { open, purchased, all: items };
  }, [serverItems, dataUpdatedAt, local, queue, listId]);
}
