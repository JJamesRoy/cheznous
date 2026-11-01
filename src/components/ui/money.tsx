"use client";

import NumberFlow from "@number-flow/react";
import { cn } from "@/lib/ui/cn";
import { formatMoney, MASKED_MONEY } from "@/lib/ui/format";

export type MoneyProps = {
  /** Integer cents. */
  cents: number;
  /** Show `+` / `−` on non-zero amounts. */
  sign?: boolean;
  /** Colour by sign (positive = owed to you, negative = you owe). Off by default. */
  tone?: "none" | "auto" | "positive" | "negative" | "muted";
  /** Roll digits when the value changes (NumberFlow). Respects reduced motion. */
  animate?: boolean;
  /** Drop cents. */
  round?: boolean;
  className?: string;
};

const toneClass = {
  none: "",
  muted: "text-fg-muted",
  positive: "text-positive",
  negative: "text-negative",
} as const;

/**
 * Amount in CAD (fr-CA: `1 234,56 $`), always tabular. In privacy mode it
 * renders `•••,•• $` (announced as "Montant masqué") — the swap is pure CSS
 * on <html data-privacy>, so nothing flashes on load.
 */
export function Money({
  cents,
  sign = false,
  tone = "none",
  animate = false,
  round = false,
  className,
}: MoneyProps) {
  const resolvedTone =
    tone === "auto" ? (cents > 0 ? "positive" : cents < 0 ? "negative" : "none") : tone;

  return (
    <span className={cn("num whitespace-nowrap", toneClass[resolvedTone], className)}>
      <span data-money-value="">
        {animate ? (
          <NumberFlow
            value={cents / 100}
            locales="fr-CA"
            format={{
              style: "currency",
              currency: "CAD",
              signDisplay: sign ? "exceptZero" : "auto",
              ...(round ? { maximumFractionDigits: 0 } : {}),
            }}
            transformTiming={{ duration: 450, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
            spinTiming={{ duration: 450, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
            opacityTiming={{ duration: 220, easing: "ease-out" }}
            respectMotionPreference
          />
        ) : (
          formatMoney(cents, { sign, round })
        )}
      </span>
      <span data-money-mask="" role="img" aria-label="Montant masqué">
        <span aria-hidden>{MASKED_MONEY}</span>
      </span>
    </span>
  );
}
