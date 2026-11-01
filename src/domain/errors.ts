/**
 * Erreur métier du domaine. `code` est stable (SCREAMING_SNAKE) et destiné aux
 * programmes (API, MCP); `message` est en français québécois (tutoiement) et peut
 * être montré tel quel à la personne.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
