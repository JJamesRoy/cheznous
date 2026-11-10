import { describe, expect, it } from "vitest";
import { contextualQuickAdd } from "@/features/app/app-frame";

describe("contextualQuickAdd", () => {
  it("follows the current page", () => {
    expect(contextualQuickAdd("/")).toEqual({ kind: "expense" });
    expect(contextualQuickAdd("/depenses")).toEqual({ kind: "expense" });
    expect(contextualQuickAdd("/listes")).toEqual({ kind: "item" });
    expect(contextualQuickAdd("/listes/abc")).toEqual({ kind: "item", prefill: { listId: "abc" } });
    expect(contextualQuickAdd("/taches")).toEqual({ kind: "task" });
    expect(contextualQuickAdd("/notes/xyz")).toEqual({ kind: "note" });
    expect(contextualQuickAdd("/budget")).toEqual({ kind: "expense" });
  });
});
