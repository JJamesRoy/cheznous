import type { z } from "zod";
import type { AnyOp, OpDef } from "./op";
import * as household from "./usecases/household";
import * as expenses from "./usecases/expenses";
import * as balances from "./usecases/balances";
import * as budget from "./usecases/budget";
import * as shopping from "./usecases/shopping";
import * as tasks from "./usecases/tasks";
import * as notes from "./usecases/notes";
import * as recurring from "./usecases/recurring";
import * as condo from "./usecases/condo";
import * as keydates from "./usecases/keydates";
import * as goals from "./usecases/goals";
import * as dashboard from "./usecases/dashboard";
import * as insights from "./usecases/insights";

/**
 * Every operation of the app. The app RPC route (/api/ops/[op]) and the MCP server
 * both dispatch through this registry — there is no other path to business logic.
 */
const modules = { household, expenses, balances, budget, shopping, tasks, notes, recurring, condo, keydates, goals, dashboard, insights };

type Modules = typeof modules;
type ExportsOf<M> = M[keyof M];
type AllOps = { [K in keyof Modules]: Extract<ExportsOf<Modules[K]>, OpDef<z.ZodType, unknown, string>> }[keyof Modules];

/** name → op definition, fully typed (used for client-side input/output types). */
export type OpMap = { [O in AllOps as O["name"]]: O };
export type OpName = keyof OpMap;
export type OpInput<N extends OpName> = z.input<OpMap[N]["input"]>;
export type OpOutput<N extends OpName> = Awaited<ReturnType<OpMap[N]["run"]>>;

export const ops: Record<string, AnyOp> = Object.fromEntries(
  Object.values(modules).flatMap((m) =>
    Object.values(m)
      .filter((v): v is AnyOp => !!v && typeof v === "object" && "name" in v && "run" in v && "input" in v)
      .map((op) => [op.name, op]),
  ),
);
