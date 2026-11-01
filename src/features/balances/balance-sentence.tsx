"use client";

import { AnimatePresence, m } from "motion/react";
import { useEffect, useState } from "react";
import { Money } from "@/components/ui";
import { cn } from "@/lib/ui/cn";

export type BalanceKind = "owed" | "owes" | "even";

const ease = [0.23, 1, 0.32, 1] as const;

/**
 * The one answer of the app, as a sentence: « Démo B te doit 142,37 $ », « Tu dois … à … »,
 * « Vous êtes quittes ». The amount rolls (NumberFlow); when the balance is settled the amount
 * first rolls to zero, then the sentence cross-fades to « Vous êtes quittes ».
 */
export function BalanceSentence({
  kind,
  amountCents,
  partnerName,
  solo = false,
  as: Tag = "p",
  className,
}: {
  kind: BalanceKind;
  amountCents: number;
  partnerName: string | null;
  solo?: boolean;
  as?: "p" | "h2" | "h1";
  className?: string;
}) {
  const [shown, setShown] = useState({ kind, amountCents });
  const [prev, setPrev] = useState({ kind, amountCents });
  if (prev.kind !== kind || prev.amountCents !== amountCents) {
    setPrev({ kind, amountCents });
    // Settled: roll the amount down to zero first, then say it (effect below).
    setShown(kind === "even" && shown.kind !== "even" ? { kind: shown.kind, amountCents: 0 } : { kind, amountCents });
  }
  useEffect(() => {
    if (kind !== "even" || shown.kind === "even") return;
    const t = window.setTimeout(() => setShown({ kind: "even", amountCents: 0 }), 650);
    return () => window.clearTimeout(t);
  }, [kind, shown.kind]);

  const name = partnerName ?? "Ton partenaire";
  const quiet = "text-fg-muted";

  return (
    <Tag
      // text-hero stays outside cn(): tailwind-merge doesn't know the "hero" size yet and would drop it.
      className={`text-hero ${cn("relative font-semibold text-balance text-fg", className)}`}
      aria-live="polite"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={shown.kind}
          className="block"
          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -4, filter: "blur(4px)", transition: { duration: 0.2 } }}
          transition={{ duration: 0.32, ease }}
        >
          {solo && shown.kind === "even" ? (
            <>Aucune balance à suivre</>
          ) : shown.kind === "even" ? (
            <>Vous êtes quittes</>
          ) : shown.kind === "owed" ? (
            <>
              {name} <span className={quiet}>te doit</span> <Money cents={shown.amountCents} animate className="text-accent-ink" />
            </>
          ) : (
            <>
              <span className={quiet}>Tu dois</span> <Money cents={shown.amountCents} animate /> <span className={quiet}>à</span> {name}
            </>
          )}
        </m.span>
      </AnimatePresence>
    </Tag>
  );
}
