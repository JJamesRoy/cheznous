import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { publicEnv, serverEnv } from "@/lib/env";
import { AppError } from "./errors";

/**
 * Budget recommendations: Claude (Anthropic API) first, OpenRouter only if that call fails
 * (credits exhausted or expired, invalid key, outage). The output is validated against the
 * same schema whichever provider answered.
 */

export const CLAUDE_MODEL = "claude-sonnet-5-5";

export const RecommendationSchema = z.object({
  /** Two or three sentences on the overall picture. */
  summary: z.string(),
  recommendations: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      /** Concrete next step the couple can take this week. */
      action: z.string(),
      area: z.enum(["budget", "depenses", "abonnements", "hypotheque", "assurance", "epargne", "partage", "autre"]),
      scope: z.enum(["foyer", "perso"]),
      priority: z.enum(["haute", "moyenne", "basse"]),
      /** Estimated monthly saving in cents, or null when it can't be estimated honestly. */
      estimatedMonthlySavingsCents: z.number().int().nullable(),
    }),
  ),
  /** Data gaps or assumptions the couple should know about. */
  caveats: z.array(z.string()),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export type AiResult = {
  result: Recommendation;
  provider: "anthropic" | "openrouter";
  model: string;
  usage: Record<string, unknown> | null;
  /** Why the primary provider was skipped, when the fallback answered. */
  fallbackReason: string | null;
};

export const SYSTEM_PROMPT = `Tu es un conseiller budgétaire pour un couple qui vit à Montréal et vient d'acheter un condo (copropriété divise au Québec). Tu reçois un instantané JSON de leurs finances tiré de l'app « Chez Nous » : budget partagé du foyer, budget perso de la personne qui te consulte (ses dépenses privées), dépenses récurrentes, hypothèque, condo, objectifs d'épargne et balance entre les deux.

Donne des recommandations concrètes pour optimiser leur budget et leurs finances, en français québécois, sur un ton simple et direct (tutoiement).

- Appuie chaque recommandation sur des chiffres présents dans les données. N'invente aucun montant, aucun taux ni aucune offre précise de fournisseur.
- Estime une économie mensuelle en cents seulement si les données le permettent ; sinon, mets null.
- « foyer » vise les dépenses partagées ; « perso » vise uniquement les dépenses privées de la personne qui consulte.
- Pense aux leviers propres au Québec quand ils s'appliquent (Hydro-Québec, taxes municipales et scolaires, frais de condo et fonds de prévoyance, assurance habitation, privilège de remboursement anticipé, CELIAPP/REER), sans donner de conseil juridique ou fiscal formel.
- Classe par impact. Donne entre 3 et 6 recommandations, sans répéter la même idée.
- Signale dans « caveats » les données manquantes ou les hypothèses importantes.`;

/** Typed failures of the primary provider that justify trying the fallback. */
function shouldFallBack(e: unknown): boolean {
  return e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError;
}

async function viaAnthropic(snapshot: string): Promise<AiResult> {
  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey, timeout: 120_000, maxRetries: 1 });
  const response = await client.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    // On a safety decline, Anthropic re-runs the request on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Analysis of one snapshot: "medium" is enough and keeps each run to a few cents.
    output_config: { effort: "medium", format: betaZodOutputFormat(RecommendationSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: snapshot }],
  });
  if (response.stop_reason === "refusal") {
    throw new AppError("AI_REFUSED", "Claude a refusé de répondre à cette demande. Réessaie plus tard.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AppError("AI_INVALID", "La réponse de Claude était incomplète. Réessaie.");
  }
  return {
    result: response.parsed_output,
    provider: "anthropic",
    model: response.model,
    usage: { ...response.usage } as Record<string, unknown>,
    fallbackReason: null,
  };
}

async function viaOpenRouter(snapshot: string, fallbackReason: string): Promise<AiResult> {
  const model = serverEnv.openRouterModel;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${serverEnv.openRouterApiKey}`,
      "content-type": "application/json",
      "http-referer": publicEnv.appUrl,
      "x-title": "Chez Nous",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: snapshot },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "budget_recommendations", strict: true, schema: z.toJSONSchema(RecommendationSchema) },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => null)) as {
    model?: string;
    usage?: Record<string, unknown>;
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string };
  } | null;
  if (!res.ok || !body) {
    throw new AppError("AI_UNAVAILABLE", `OpenRouter a refusé la demande (${res.status}${body?.error?.message ? ` : ${body.error.message}` : ""}).`);
  }
  const text = body.choices?.[0]?.message?.content ?? "";
  // Some models wrap JSON in a code fence despite response_format.
  const json = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AppError("AI_INVALID", "La réponse d'OpenRouter n'était pas du JSON valide. Réessaie.");
  }
  const result = RecommendationSchema.safeParse(parsed);
  if (!result.success) throw new AppError("AI_INVALID", "La réponse d'OpenRouter ne suit pas le format attendu. Réessaie.");
  return { result: result.data, provider: "openrouter", model: body.model ?? model, usage: body.usage ?? null, fallbackReason };
}

export function aiConfigured(): boolean {
  return Boolean(serverEnv.anthropicApiKey || serverEnv.openRouterApiKey);
}

export async function recommend(snapshot: string): Promise<AiResult> {
  if (!aiConfigured()) {
    throw new AppError("AI_NOT_CONFIGURED", "Les conseils IA ne sont pas configurés : ajoute ANTHROPIC_API_KEY (ou OPENROUTER_API_KEY) au serveur.");
  }
  if (!serverEnv.anthropicApiKey) return viaOpenRouter(snapshot, "ANTHROPIC_API_KEY absente");
  try {
    return await viaAnthropic(snapshot);
  } catch (e) {
    if (!shouldFallBack(e)) throw e;
    const reason = e instanceof Anthropic.APIError && e.status ? `Claude API ${e.status}` : "Claude API injoignable";
    console.error("[ai] Claude API failed, trying OpenRouter:", reason);
    if (!serverEnv.openRouterApiKey) {
      throw new AppError(
        "AI_UNAVAILABLE",
        e instanceof Anthropic.RateLimitError
          ? "Trop de demandes à Claude pour le moment. Réessaie dans une minute."
          : "Claude est indisponible (crédit épuisé ou expiré ?) et aucun repli OpenRouter n'est configuré.",
      );
    }
    return viaOpenRouter(snapshot, reason);
  }
}
