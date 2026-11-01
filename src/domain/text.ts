const COMBINING_MARKS = /\p{M}+/gu;
const NON_ALNUM = /[^a-z0-9]+/g;
/** Lettres que la décomposition Unicode ne sépare pas mais que `unaccent` translittère. */
const SPECIAL: Record<string, string> = { "œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };
const SPECIAL_RE = new RegExp(`[${Object.keys(SPECIAL).join("")}]`, "g");

/**
 * Clé de comparaison : minuscules, sans diacritiques (NFKD puis retrait de \p{M};
 * NFKD plutôt que NFD pour aussi défaire les ligatures « ﬁ » comme `unaccent`),
 * œ→oe, æ→ae, toute suite de caractères hors [a-z0-9] → une espace, puis trim.
 * Équivaut au SQL `btrim(regexp_replace(lower(unaccent(x)), '[^a-z0-9]+', ' ', 'g'))`
 * pour du texte français usuel.
 */
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(SPECIAL_RE, (c) => SPECIAL[c])
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NON_ALNUM, " ")
    .trim();
}

export type MatchResult<T> =
  | { kind: "match"; item: T }
  | { kind: "ambiguous"; options: T[] }
  | { kind: "none"; options: T[] };

/**
 * Résolution d'un nom saisi (ex. par MCP : « épicerie ») parmi des éléments.
 * Étapes, sur les clés normalisées; à chaque étape : 1 candidat → match,
 * plusieurs → ambiguous (on ne passe pas à l'étape suivante), 0 → étape suivante :
 *  1. égalité exacte;
 *  2. le nom commence par la requête;
 *  3. le nom contient la requête, ou la requête contient le nom entier;
 *  4. un mot de la requête (≥ 3 lettres) est un mot du nom ou un préfixe d'un mot du nom.
 * Aucun → none avec tous les éléments comme options.
 */
export function matchByName<T>(items: T[], query: string, getName: (t: T) => string): MatchResult<T> {
  const q = normalizeKey(query);
  if (q === "") return { kind: "none", options: [...items] };
  const keyed = items.map((item) => ({ item, key: normalizeKey(getName(item)) }));
  const qWords = q.split(" ").filter((w) => w.length >= 3);
  const stages: ((k: string) => boolean)[] = [
    (k) => k === q,
    (k) => k.startsWith(q),
    (k) => k.includes(q) || (k.length > 0 && ` ${q} `.includes(` ${k} `)),
    (k) => {
      const words = k.split(" ");
      return qWords.some((qw) => words.some((w) => w === qw || w.startsWith(qw)));
    },
  ];
  for (const test of stages) {
    const hits = keyed.filter((x) => test(x.key)).map((x) => x.item);
    if (hits.length === 1) return { kind: "match", item: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", options: hits };
  }
  return { kind: "none", options: [...items] };
}
