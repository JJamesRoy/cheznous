import { describe, expect, it } from "vitest";
import { matchByName, normalizeKey } from "../../src/domain";

describe("normalizeKey", () => {
  it.each([
    ["Épicerie", "epicerie"],
    ["  Électricité — Hydro-Québec ", "electricite hydro quebec"],
    ["Garçon", "garcon"],
    ["Œufs & bœuf", "oeufs boeuf"],
    ["ÆSIR", "aesir"],
    ["Café/Resto", "cafe resto"],
    ["Taxes municipales 2026!!", "taxes municipales 2026"],
    ["L'épicerie du mois", "l epicerie du mois"],
    ["Noël à l’île", "noel a l ile"],
    ["ﬁlet", "filet"],
    ["Straße", "strasse"],
    ["", ""],
    ["---", ""],
  ])("%j → %j", (input, out) => {
    expect(normalizeKey(input)).toBe(out);
  });
});

describe("matchByName", () => {
  const cats = [{ name: "Épicerie" }, { name: "Restaurants" }, { name: "Électricité" }, { name: "Épargne" }, { name: "Loisirs" }, { name: "Restauration rapide" }];
  const get = (c: { name: string }) => c.name;

  it("exact normalized equality wins", () => {
    expect(matchByName(cats, "epicerie", get)).toEqual({ kind: "match", item: cats[0] });
    expect(matchByName(cats, "  ÉLECTRICITÉ ", get)).toEqual({ kind: "match", item: cats[2] });
  });
  it("unique prefix", () => {
    expect(matchByName(cats, "épic", get)).toEqual({ kind: "match", item: cats[0] });
    expect(matchByName(cats, "loi", get)).toEqual({ kind: "match", item: cats[4] });
  });
  it("ambiguous prefix returns candidates", () => {
    expect(matchByName(cats, "ep", get)).toEqual({ kind: "ambiguous", options: [cats[0], cats[3]] });
    expect(matchByName(cats, "rest", get)).toEqual({ kind: "ambiguous", options: [cats[1], cats[5]] });
    // "resto" is not a prefix of either; falls through to contains/word stages → none
    expect(matchByName(cats, "resto", get).kind).toBe("none");
  });
  it("contains (both directions) and word match", () => {
    expect(matchByName(cats, "rapide", get)).toEqual({ kind: "match", item: cats[5] });
    expect(matchByName(cats, "facture électricité hydro", get)).toEqual({ kind: "match", item: cats[2] });
    expect(matchByName(cats, "sorties loisirs", get)).toEqual({ kind: "match", item: cats[4] });
    expect(matchByName([{ name: "Hydro-Québec" }, { name: "Bell" }], "facture hydro", get)).toEqual({ kind: "match", item: { name: "Hydro-Québec" } });
  });
  it("none returns all items", () => {
    expect(matchByName(cats, "voyage", get)).toEqual({ kind: "none", options: cats });
    expect(matchByName(cats, "   ", get)).toEqual({ kind: "none", options: cats });
  });
  it("exact beats prefix even if prefix is ambiguous", () => {
    const items = [{ name: "Lait" }, { name: "Lait d'avoine" }];
    expect(matchByName(items, "lait", get)).toEqual({ kind: "match", item: items[0] });
  });
});
