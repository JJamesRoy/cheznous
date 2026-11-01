"use client";

import { Check, ChevronsRight } from "lucide-react";
import { animate, m, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { haptic } from "@/lib/ui/haptics";
import { Spinner } from "./spinner";

export type SlideToConfirmProps = {
  /** Called once the thumb passes 90 % (or Enter/Space on the focused thumb). */
  onConfirm: () => void | Promise<void>;
  label?: string;
  /** Shown while `onConfirm` resolves. */
  pendingLabel?: string;
  /** Shown after success. */
  confirmedLabel?: string;
  disabled?: boolean;
  className?: string;
};

const THUMB = 48;
const PAD = 4;
const spring = { type: "spring", stiffness: 520, damping: 42, mass: 0.9 } as const;

type Status = "idle" | "pending" | "confirmed";

/**
 * Drag the thumb across the track to confirm (recording a settlement).
 * Completes at 90 %, springs back otherwise. Keyboard: focus the thumb and
 * press Enter or Space. Reduced motion: no spring, instant moves.
 */
export function SlideToConfirm({
  onConfirm,
  label = "Glisse pour régler",
  pendingLabel = "Enregistrement…",
  confirmedLabel = "Réglé",
  disabled = false,
  className,
}: SlideToConfirmProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startValue: number; max: number; pointerId: number } | null>(
    null,
  );
  const x = useMotionValue(0);
  const reduced = useReducedMotion();
  const maxX = useMotionValue(0);
  const [status, setStatus] = useState<Status>("idle");

  // The label fades as the thumb travels; the trail's right edge follows the thumb.
  const labelOpacity = useTransform<number, number>([x, maxX], ([value, max]) =>
    max > 0 ? Math.max(0, 1 - (value / max) * 1.6) : 1,
  );
  const trailX = useTransform(x, (value) => value + THUMB + PAD);

  function measure(): number {
    const track = trackRef.current;
    if (!track) return 0;
    const next = Math.max(0, track.getBoundingClientRect().width - THUMB - PAD * 2);
    maxX.set(next);
    return next;
  }

  function moveTo(target: number): Promise<void> {
    if (reduced) {
      x.set(target);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      void animate(x, target, spring).then(() => resolve());
    });
  }

  async function confirm(limit: number) {
    if (status !== "idle") return;
    haptic("success");
    await moveTo(limit);
    setStatus("pending");
    try {
      await onConfirm();
      setStatus("confirmed");
    } catch {
      x.set(limit);
      setStatus("idle");
      void moveTo(0);
    }
  }

  const busy = status !== "idle" || disabled;
  // Once confirmed (or pending) the thumb is pinned to the end with CSS, so it
  // stays right even if the track is resized.
  const pinned = status !== "idle";

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-14 w-full overflow-hidden rounded-full border border-border bg-surface-2 select-none",
        disabled && "opacity-50",
        className,
      )}
    >
      {/* Accent trail: a full-width layer parked left of the track, translated in. */}
      <m.span
        aria-hidden
        className="absolute inset-y-0 right-full w-full rounded-full bg-accent-soft"
        style={{ x: pinned ? "100%" : trailX }}
      />
      <m.span
        aria-hidden
        style={{ opacity: status === "idle" ? labelOpacity : 1 }}
        className="pointer-events-none absolute inset-0 flex items-center justify-center pl-12 text-base font-medium text-fg-muted"
      >
        {status === "idle" ? label : status === "pending" ? pendingLabel : confirmedLabel}
      </m.span>
      <m.button
        type="button"
        aria-label={label}
        aria-disabled={busy || undefined}
        disabled={disabled}
        style={{
          x: pinned ? 0 : x,
          width: THUMB,
          height: THUMB,
          top: PAD - 1,
          left: pinned ? `calc(100% - ${THUMB + PAD - 1}px)` : PAD - 1,
        }}
        className={cn(
          "absolute flex touch-none items-center justify-center rounded-full bg-accent text-accent-fg",
          busy ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={(event) => {
          if (busy || event.button !== 0) return;
          const limit = measure();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            startX: event.clientX,
            startValue: x.get(),
            max: limit,
            pointerId: event.pointerId,
          };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state || state.pointerId !== event.pointerId) return;
          const next = Math.min(Math.max(state.startValue + event.clientX - state.startX, 0), state.max);
          x.set(next);
        }}
        onPointerUp={(event) => {
          const state = drag.current;
          if (!state || state.pointerId !== event.pointerId) return;
          drag.current = null;
          if (state.max > 0 && x.get() >= state.max * 0.9) void confirm(state.max);
          else moveTo(0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          moveTo(0);
        }}
        onClick={(event) => {
          // Keyboard activation only (Enter/Space give detail 0); taps don't confirm.
          if (event.detail !== 0 || busy) return;
          void confirm(measure());
        }}
      >
        {status === "pending" ? (
          <Spinner />
        ) : status === "confirmed" ? (
          <Check className="size-5" aria-hidden />
        ) : (
          <ChevronsRight className="size-5" aria-hidden />
        )}
      </m.button>
      <span className="sr-only" aria-live="polite">
        {status === "pending" ? pendingLabel : status === "confirmed" ? confirmedLabel : ""}
      </span>
    </div>
  );
}
