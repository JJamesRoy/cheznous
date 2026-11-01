import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Ctx } from "../server/ctx";
import { AppError, serializeError } from "../server/errors";
import { serverEnv } from "../lib/env";
import { registerTools } from "./tools";

export const MCP_SERVER_INFO = { name: "chez-nous", version: "1.0.0" };

const INSTRUCTIONS = `Chez Nous : dépenses partagées, budget, listes, tâches, notes et condo d'un couple à Montréal.
Appelle d'abord get_household_context pour connaître les membres (qui est « moi »), les catégories, les listes et la répartition par défaut.
Les montants en entrée sont des chaînes décimales ("85", "85,50") ou des cents ({"cents": 8550}). Les sorties donnent toujours les cents et le format fr-CA.
« moi » désigne la personne connectée; le partenaire peut être désigné par son prénom. Les noms de catégories et de listes sont comparés sans tenir compte des accents ni de la casse.
Toute écriture accepte idempotency_key : réutilise la même clé si tu réessaies le même appel.
create_settlement exige confirm: true ; sans cela, l'outil renvoie un aperçu sans rien enregistrer. Il n'y a pas d'outil de suppression.`;

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

export type ToolDef<S extends z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations: ToolAnnotations;
  run: (ctx: Ctx, args: z.output<z.ZodObject<S>>) => Promise<Record<string, unknown>>;
};

const SENSITIVE_KEYS = new Set(["notes", "note", "body", "body_md", "content", "description", "title", "name", "query"]);

/** Argument summary for the audit log: keys and short scalar values, no free text. */
export function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (SENSITIVE_KEYS.has(k)) out[k] = typeof v === "string" ? `<${v.length} car.>` : "<…>";
    else if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.length > 40 ? `${v.slice(0, 40)}…` : v;
    else out[k] = Array.isArray(v) ? `<liste ${v.length}>` : "<objet>";
  }
  return out;
}

async function rateLimited(ctx: Ctx): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await ctx.db
    .from("mcp_tool_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .gte("at", since);
  if (error) return false; // never block on the limiter itself
  return (count ?? 0) >= serverEnv.mcpRateLimitPerMinute;
}

async function logCall(ctx: Ctx, tool: string, args: Record<string, unknown>, status: string, latencyMs: number, errorCode?: string) {
  const { error } = await ctx.db.from("mcp_tool_calls").insert({
    user_id: ctx.userId,
    household_id: ctx.household?.id ?? null,
    client_id: ctx.clientId,
    tool,
    args_summary: summarizeArgs(args),
    status,
    error_code: errorCode ?? null,
    latency_ms: Math.round(latencyMs),
  });
  if (error) console.error("[mcp] audit log failed", error.message);
}

function asText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: INSTRUCTIONS, capabilities: { tools: {} } });

  const register = <S extends z.ZodRawShape>(def: ToolDef<S>) => {
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.input, annotations: { title: def.title, ...def.annotations } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any): Promise<ToolResult> => {
        const started = performance.now();
        if (await rateLimited(ctx)) {
          await logCall(ctx, def.name, args, "rate_limited", performance.now() - started, "RATE_LIMITED");
          const err = { code: "RATE_LIMITED", message: `Limite de ${serverEnv.mcpRateLimitPerMinute} appels par minute atteinte. Réessaie dans une minute.` };
          return { isError: true, content: [{ type: "text", text: asText({ error: err }) }], structuredContent: { error: err } };
        }
        try {
          const result = await def.run(ctx, args);
          const status = result && typeof result === "object" && (result as { status?: string }).status === "preview" ? "preview" : "ok";
          await logCall(ctx, def.name, args, status, performance.now() - started);
          return { content: [{ type: "text", text: asText(result) }], structuredContent: result };
        } catch (e) {
          const err = serializeError(e);
          await logCall(ctx, def.name, args, "error", performance.now() - started, String(err.code));
          return { isError: true, content: [{ type: "text", text: asText({ error: err }) }], structuredContent: { error: err } };
        }
      }) as never,
    );
  };

  registerTools(register);
  return server;
}

export type Register = <S extends z.ZodRawShape>(def: ToolDef<S>) => void;

export function requireMcpHousehold(ctx: Ctx) {
  if (!ctx.household) throw new AppError("NO_HOUSEHOLD", "Ce compte n'a pas encore de foyer. Crée-le dans l'app Chez Nous.");
}
