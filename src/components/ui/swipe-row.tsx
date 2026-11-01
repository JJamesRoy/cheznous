"use client";

import { animate, m, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { haptic } from "@/lib/ui/haptics";

export type SwipeAction = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "accent" | "danger";
  onAction: () => void;
};

export type SwipeRowProps = {
  /** Revealed by swiping right (max 2). The first one is the full-swipe action. */
  leadingActions?: SwipeAction[];
  /** Revealed by swiping left (max 2). The first one is the full-swipe action. */
  trailingActions?: SwipeAction[];
  /** Disable full-swipe commits (actions still reveal). */
  fullSwipe?: boolean;
  className?: string;
  children: React.ReactNode;
};

const ACTION_W = 76;
const THRESHOLD = 72;
const AXIS_LOCK = 8;
const spring = { type: "spring", stiffness: 600, damping: 48 } as const;

const tones: Record<NonNullable<SwipeAction["tone"]>, string> = {
  neutral: "bg-gray-6 text-fg",
  accent: "bg-accent text-accent-fg",
  danger: "bg-negative text-bg",
};

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: number;
  width: number;
  axis: "x" | "y" | null;
};

/**
 * Horizontal swipe to reveal up to two actions per side (pointer-based, works
 * with touch and mouse). Past 72px it snaps open; a long swipe commits the
 * primary action. Vertical scrolling stays native (`touch-action: pan-y`).
 * Actions remain reachable by keyboard: focusing one opens its side.
 */
export function SwipeRow({
  leadingActions = [],
  trailingActions = [],
  fullSwipe = true,
  className,
  children,
}: SwipeRowProps) {
  const leading = leadingActions.slice(0, 2);
  const trailing = trailingActions.slice(0, 2);
  const x = useMotionValue(0);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [open, setOpen] = useState<"leading" | "trailing" | null>(null);

  const leadingW = leading.length * ACTION_W;
  const trailingW = trailing.length * ACTION_W;

  const leadingOpacity = useTransform(x, (v) => (v > 0 ? 1 : 0));
  const trailingOpacity = useTransform(x, (v) => (v < 0 ? 1 : 0));

  function settle(target: number) {
    if (reduced) x.set(target);
    else animate(x, target, spring);
    setOpen(target > 0 ? "leading" : target < 0 ? "trailing" : null);
  }

  function commit(action: SwipeAction, direction: 1 | -1, width: number) {
    haptic("light");
    const done = () => {
      action.onAction();
      x.set(0);
      setOpen(null);
    };
    if (reduced) done();
    else
      void animate(x, direction * width, { duration: 0.18, ease: [0.23, 1, 0.32, 1] }).then(done);
  }

  // Close when tapping elsewhere.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        if (reduced) x.set(0);
        else animate(x, 0, spring);
        setOpen(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, reduced, x]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: x.get(),
      width: event.currentTarget.getBoundingClientRect().width,
      axis: null,
    };
    suppressClick.current = false;
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (g.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.axis === "y") {
        gesture.current = null;
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      suppressClick.current = true;
    }
    let next = g.origin + dx;
    // No actions on a side: resist strongly.
    if (next > 0 && leading.length === 0) next = next * 0.15;
    if (next < 0 && trailing.length === 0) next = next * 0.15;
    // Rubber band past the revealed width unless full swipe is possible.
    const limit = next > 0 ? leadingW : trailingW;
    if (!fullSwipe && Math.abs(next) > limit) {
      const over = Math.abs(next) - limit;
      next = Math.sign(next) * (limit + over * 0.25);
    }
    x.set(next);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.pointerId !== event.pointerId || g.axis !== "x") return;
    const value = x.get();
    const side = value > 0 ? leading : trailing;
    const direction: 1 | -1 = value > 0 ? 1 : -1;
    if (side.length === 0) return settle(0);
    if (fullSwipe && Math.abs(value) > Math.max(g.width * 0.6, ACTION_W * side.length + 48)) {
      return commit(side[0], direction, g.width);
    }
    if (Math.abs(value) > THRESHOLD) return settle(direction * side.length * ACTION_W);
    settle(0);
  }

  function renderActions(actions: SwipeAction[], side: "leading" | "trailing") {
    if (actions.length === 0) return null;
    return (
      <m.div
        style={{ opacity: side === "leading" ? leadingOpacity : trailingOpacity }}
        className={cn("absolute inset-y-0 flex", side === "leading" ? "left-0" : "right-0 flex-row-reverse")}
      >
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onFocus={() => settle((side === "leading" ? 1 : -1) * actions.length * ACTION_W)}
            onClick={() => {
              action.onAction();
              settle(0);
            }}
            style={{ width: ACTION_W }}
            className={cn(
              "flex h-full flex-col items-center justify-center gap-1 text-xs font-medium focus-visible:-outline-offset-4 [&_svg]:size-5",
              tones[action.tone ?? "neutral"],
            )}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </m.div>
    );
  }

  return (
    <div ref={rootRef} className={cn("relative overflow-hidden", className)}>
      {renderActions(leading, "leading")}
      {renderActions(trailing, "trailing")}
      <m.div
        style={{ x }}
        className="relative touch-pan-y bg-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
          settle(open === "leading" ? leadingW : open === "trailing" ? -trailingW : 0);
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          } else if (open) {
            event.preventDefault();
            event.stopPropagation();
            settle(0);
          }
        }}
      >
        {children}
      </m.div>
    </div>
  );
}
