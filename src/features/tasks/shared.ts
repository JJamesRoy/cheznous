import { addDays, dayOfWeek, diffDays, formatDateFr } from "@/domain/dates";
import { FREQUENCY_LABELS_FR, type Frequency } from "@/domain/recurrence";
import type { OpOutput } from "@/lib/data/api";

export type Task = OpOutput<"tasks.list">["tasks"][number];
export type TaskFrequency = Exclude<Frequency, "installments">;

export const TASK_FREQUENCIES: TaskFrequency[] = ["weekly", "biweekly", "monthly", "bimonthly", "quarterly", "semiannual", "yearly"];

export const FREQUENCY_OPTIONS = [
  { value: "none", label: "Une seule fois" },
  ...TASK_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS_FR[f] })),
];

export function frequencyLabel(f: TaskFrequency | null | undefined): string | null {
  return f ? FREQUENCY_LABELS_FR[f] : null;
}

export const TASK_PRIORITY_LABELS: Record<0 | 1 | 2, string> = { 0: "Normale", 1: "Important", 2: "Urgent" };

/** Next Saturday (today if it is Saturday). */
export function nextSaturday(today: string): string {
  return addDays(today, (6 - dayOfWeek(today) + 7) % 7);
}

/** "Aujourd'hui", "Demain", "Dans 3 jours", "15 déc. 2026"; overdue → "En retard · 2 jours". */
export function dueText(dueOn: string, today: string): { text: string; overdue: boolean } {
  const n = diffDays(today, dueOn);
  if (n < 0) return { text: n === -1 ? "En retard · hier" : `En retard · ${-n} jours`, overdue: true };
  if (n === 0) return { text: "Aujourd'hui", overdue: false };
  if (n === 1) return { text: "Demain", overdue: false };
  if (n <= 6) return { text: `Dans ${n} jours`, overdue: false };
  return { text: formatDateFr(dueOn), overdue: false };
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(/[,#\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}
