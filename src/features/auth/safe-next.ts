/** Only same-origin relative paths are accepted as a post-auth destination. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Append `?next=` to an auth route when there is a destination worth keeping. */
export function withNext(path: string, next: string | null | undefined): string {
  const n = safeNext(next, "");
  return n && n !== "/" ? `${path}?next=${encodeURIComponent(n)}` : path;
}
