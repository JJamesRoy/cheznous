import { DomainError } from "../domain/errors";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NO_HOUSEHOLD"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "AMBIGUOUS"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "RATE_LIMITED"
  | "CONFIRMATION_REQUIRED"
  | "INTERNAL"
  | (string & {});

/** Typed, user-presentable error. `message` is Québec French; `code` is stable for clients. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const httpStatusFor = (code: ErrorCode): number => {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "NO_HOUSEHOLD":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
    case "IDEMPOTENCY_IN_PROGRESS":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "INTERNAL":
      return 500;
    default:
      return 400;
  }
};

export type SerializedError = { code: ErrorCode; message: string; details?: unknown };

/** Hints raised by our SQL functions (`raise … using hint = 'CODE'`). */
const SQL_HINTS: Record<string, string> = {
  ALREADY_MEMBER: "Tu fais déjà partie d'un foyer.",
  INVITE_INVALID: "Cette invitation n'existe pas.",
  INVITE_REVOKED: "Cette invitation a été annulée.",
  INVITE_USED: "Cette invitation a déjà été utilisée.",
  INVITE_EXPIRED: "Cette invitation est expirée. Demande un nouveau lien.",
  HOUSEHOLD_FULL: "Ce foyer compte déjà deux membres.",
  IDEMPOTENCY_CONFLICT: "Cette clé d'idempotence a déjà servi pour une autre requête.",
  IDEMPOTENCY_IN_PROGRESS: "Une requête identique est déjà en cours.",
  NOT_FOUND: "Introuvable.",
};

type PgError = { code?: string; message?: string; hint?: string | null; details?: string | null };

/** Map a PostgREST / Postgres error to an AppError. Never leaks SQL text to clients. */
export function fromDbError(error: PgError, fallback = "L'opération a échoué."): AppError {
  if (error.hint && SQL_HINTS[error.hint]) {
    const code = error.hint === "NOT_FOUND" ? "NOT_FOUND" : error.hint;
    return new AppError(code, SQL_HINTS[error.hint]);
  }
  switch (error.code) {
    case "42501": // insufficient_privilege (RLS)
      return new AppError("FORBIDDEN", "Tu n'as pas accès à cette ressource.");
    case "23505":
      return new AppError("CONFLICT", "Cet élément existe déjà.");
    case "23503":
      return new AppError("VALIDATION", "Un élément lié est introuvable dans ton foyer.");
    case "23514":
      return new AppError("VALIDATION", "Les données ne respectent pas les règles (ex. : la répartition doit égaler le total).");
    case "22P02":
    case "22007":
    case "22008":
      return new AppError("VALIDATION", "Une valeur n'a pas le bon format.");
    case "PGRST116":
      return new AppError("NOT_FOUND", "Introuvable.");
    case "PGRST301":
    case "PGRST302":
      return new AppError("UNAUTHENTICATED", "Ta session a expiré. Reconnecte-toi.");
    default:
      console.error("[db]", error.code, error.message);
      return new AppError("INTERNAL", fallback);
  }
}

export function serializeError(e: unknown): SerializedError {
  if (e instanceof AppError) return { code: e.code, message: e.message, details: e.details };
  if (e instanceof DomainError) return { code: e.code, message: e.message, details: e.details };
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const issues = (e as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    return {
      code: "VALIDATION",
      message: "Certains champs sont invalides.",
      details: issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    };
  }
  console.error("[unexpected]", e);
  return { code: "INTERNAL", message: "Une erreur inattendue est survenue." };
}

/** Unwrap a supabase-js `{ data, error }` result. */
export function unwrap<T>(res: { data: T | null; error: PgError | null }, fallback?: string): T {
  if (res.error) throw fromDbError(res.error, fallback);
  return res.data as T;
}
