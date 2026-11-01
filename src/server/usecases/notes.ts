import { z } from "zod";
import { defineOp } from "../op";
import { AppError, fromDbError, unwrap } from "../errors";
import { memberName, type HouseholdCtx } from "../ctx";
import { idempotent, zIdempotencyKey } from "../support";

type NoteRow = {
  id: string;
  title: string;
  body_md: string;
  is_private: boolean;
  pinned: boolean;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
};
const NOTE_SELECT = "id, title, body_md, is_private, pinned, tags, created_by, created_at, updated_at";

function excerpt(md: string, n = 140) {
  const plain = md.replace(/[#>*_`~\-[\]()!]/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > n ? `${plain.slice(0, n - 1)}…` : plain;
}

function toNote(ctx: HouseholdCtx, r: NoteRow, full = true) {
  return {
    id: r.id,
    title: r.title || "Sans titre",
    ...(full ? { bodyMd: r.body_md } : {}),
    excerpt: excerpt(r.body_md),
    isPrivate: r.is_private,
    pinned: r.pinned,
    tags: r.tags,
    author: { userId: r.created_by, name: memberName(ctx, r.created_by), isMe: r.created_by === ctx.userId },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function fetchNote(ctx: HouseholdCtx, id: string) {
  const row = unwrap(await ctx.db.from("notes").select(NOTE_SELECT).eq("household_id", ctx.household.id).eq("id", id).maybeSingle()) as NoteRow | null;
  if (!row) throw new AppError("NOT_FOUND", "Note introuvable.");
  return row;
}

export const listNotes = defineOp({
  name: "notes.list",
  kind: "read",
  input: z.object({ tag: z.string().max(40).optional(), limit: z.number().int().min(1).max(200).default(100) }),
  run: async (ctx, input) => {
    let q = ctx.db.from("notes").select(NOTE_SELECT).eq("household_id", ctx.household.id);
    if (input.tag) q = q.contains("tags", [input.tag]);
    const rows = unwrap(await q.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(input.limit)) as NoteRow[];
    return { notes: rows.map((r) => toNote(ctx, r, false)) };
  },
});

/** Full-text search with the French configuration (stemming: « factures » finds « facture »). */
export const searchNotes = defineOp({
  name: "notes.search",
  kind: "read",
  input: z.object({ q: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50).default(20) }),
  run: async (ctx, input) => {
    const res = await ctx.db.rpc("search_notes", { p_household: ctx.household.id, p_query: input.q, p_limit: input.limit });
    if (res.error) throw fromDbError(res.error);
    const rows = res.data as { id: string; title: string; snippet: string; rank: number; updated_at: string; pinned: boolean; is_private: boolean }[];
    let results = rows.map((r) => ({ id: r.id, title: r.title || "Sans titre", snippet: r.snippet, pinned: r.pinned, isPrivate: r.is_private, updatedAt: r.updated_at }));
    if (results.length === 0) {
      // Fallback for partial words (« plomb » → « plombier ») that the stemmer won't match.
      const like = `%${input.q.replace(/[%_,()"\\*]/g, " ").trim()}%`;
      const fb = unwrap(
        await ctx.db.from("notes").select(NOTE_SELECT).eq("household_id", ctx.household.id).or(`title.ilike.${like},body_md.ilike.${like}`).limit(input.limit),
      ) as NoteRow[];
      results = fb.map((r) => ({ id: r.id, title: r.title || "Sans titre", snippet: excerpt(r.body_md), pinned: r.pinned, isPrivate: r.is_private, updatedAt: r.updated_at }));
    }
    return { query: input.q, results };
  },
});

export const getNote = defineOp({
  name: "notes.get",
  kind: "read",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const note = toNote(ctx, await fetchNote(ctx, input.id));
    const docs = unwrap(
      await ctx.db.from("documents").select("id, title, storage_path, external_url, mime_type, created_at").eq("household_id", ctx.household.id).eq("note_id", input.id),
    ) as { id: string; title: string; storage_path: string | null; external_url: string | null; mime_type: string | null; created_at: string }[];
    return { note, attachments: docs };
  },
});

const zNoteFields = z.object({
  title: z.string().max(160).optional(),
  bodyMd: z.string().max(50000).optional(),
  isPrivate: z.boolean().optional(),
  pinned: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

function notePatch(input: z.infer<typeof zNoteFields>) {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.bodyMd !== undefined) patch.body_md = input.bodyMd;
  if (input.isPrivate !== undefined) patch.is_private = input.isPrivate;
  if (input.pinned !== undefined) patch.pinned = input.pinned;
  if (input.tags !== undefined) patch.tags = [...new Set(input.tags.map((t) => t.toLowerCase()))];
  return patch;
}

export const createNote = defineOp({
  name: "notes.create",
  kind: "write",
  input: zNoteFields.extend({ idempotencyKey: zIdempotencyKey.optional() }),
  run: async (ctx, input) =>
    idempotent(ctx, input.idempotencyKey, "notes.create", input, async () => {
      if (!input.title?.trim() && !input.bodyMd?.trim()) throw new AppError("VALIDATION", "La note est vide.");
      const row = unwrap(
        await ctx.db.from("notes").insert({ household_id: ctx.household.id, created_by: ctx.userId, ...notePatch(input) }).select(NOTE_SELECT).single(),
      ) as NoteRow;
      return { note: toNote(ctx, row) };
    }),
});

export const updateNote = defineOp({
  name: "notes.update",
  kind: "write",
  input: zNoteFields.extend({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const cur = await fetchNote(ctx, input.id);
    if (input.isPrivate !== undefined && input.isPrivate !== cur.is_private && cur.created_by !== ctx.userId) {
      throw new AppError("FORBIDDEN", "Seule la personne qui a écrit la note peut changer sa confidentialité.");
    }
    const row = unwrap(await ctx.db.from("notes").update(notePatch(input)).eq("household_id", ctx.household.id).eq("id", input.id).select(NOTE_SELECT).single()) as NoteRow;
    return { note: toNote(ctx, row) };
  },
});

export const deleteNote = defineOp({
  name: "notes.delete",
  kind: "write",
  input: z.object({ id: z.string().uuid() }),
  run: async (ctx, input) => {
    const snapshot = toNote(ctx, await fetchNote(ctx, input.id));
    unwrap(await ctx.db.from("notes").delete().eq("household_id", ctx.household.id).eq("id", input.id));
    return { deleted: snapshot };
  },
});
