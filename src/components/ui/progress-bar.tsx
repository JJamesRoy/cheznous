"use client";

import { Progress } from "radix-ui";
import { cn } from "@/lib/ui/cn";

export type ProgressTone = "auto" | "neutral" | "accent" | "positive" | "warning" | "negative" | "muted";

export type ProgressBarProps = {
  /** Current value (e.g. spent cents). */
  value: number;
  /** Target (e.g. budget cents). */
  max: number;
  /**
   * `auto` (budgets): neutral below 85 %, warning from 85 %, negative over 100 %.
   */
  tone?: ProgressTone;
  /** Accessible label, e.g. "Épicerie : 82 % du budget". */
  label: string;
  /** Text for assistive tech, e.g. "412 $ sur 500 $". */
  valueText?: string;
  size?: "sm" | "md";
  className?: string;
};

const fills: Record<Exclude<ProgressTone, "auto">, string> = {
  neutral: "bg-fg",
  accent: "bg-accent",
  muted: "bg-gray-9",
  positive: "bg-positive",
  warning: "bg-warning",
  negative: "bg-negative",
};

export function progressTone(ratio: number): Exclude<ProgressTone, "auto"> {
  if (ratio > 1) return "negative";
  if (ratio >= 0.85) return "warning";
  // Under budget, the bar is the screen's main data element: the one data hue.
  return "accent";
}

/** Track in gray-5; the fill slides in with a transform (no width animation). */
export function ProgressBar({
  value,
  max,
  tone = "auto",
  label,
  valueText,
  size = "md",
  className,
}: ProgressBarProps) {
  const ratio = max > 0 ? value / max : 0;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const resolved = tone === "auto" ? progressTone(ratio) : tone;
  return (
    <Progress.Root
      value={Math.min(Math.max(value, 0), max)}
      max={max > 0 ? max : 1}
      aria-label={label}
      getValueLabel={() => valueText ?? `${Math.round(ratio * 100)} %`}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-track",
        size === "sm" ? "h-1" : "h-1.5",
        className,
      )}
    >
      <Progress.Indicator
        className={cn(
          "h-full w-full rounded-full transition-transform duration-[320ms] ease-snappy",
          fills[resolved],
        )}
        // Translate (not scale) so the rounded end keeps its shape.
        style={{ transform: `translateX(${(clamped - 1) * 100}%)` }}
      />
    </Progress.Root>
  );
}
