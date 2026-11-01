"use client";

import { ArrowDown } from "lucide-react";
import { animate, m, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { haptic } from "@/lib/ui/haptics";
import { useIsTouch } from "@/lib/ui/use-media-query";
import { Spinner } from "./spinner";

const TRIGGER = 72;
const MAX_PULL = 120;
const HOLD = 52;

export type PullToRefreshProps = {
  onRefresh: () => Promise<unknown>;
  /** Turn the gesture off (e.g. while a sheet is open). */
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
};

/**
 * Pull down at the top of the page to refresh. Only active on touch devices
 * (coarse pointer); elsewhere it renders the children untouched.
 */
export function PullToRefresh({ onRefresh, disabled = false, className, children }: PullToRefreshProps) {
  const touch = useIsTouch();
  const enabled = touch && !disabled;
  const y = useMotionValue(0);
  const reduced = useReducedMotion();
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  const indicatorOpacity = useTransform(y, [0, 24, TRIGGER], [0, 0.4, 1]);
  const indicatorY = useTransform(y, (v) => v / 2 - 20);
  const arrowRotate = useTransform(y, [TRIGGER - 16, TRIGGER], [0, 180]);

  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let pulling = false;
    let isArmed = false;

    const to = (target: number) => {
      if (reduced) y.set(target);
      else animate(y, target, { duration: 0.32, ease: [0.23, 1, 0.32, 1] });
    };

    function onTouchStart(event: TouchEvent) {
      if (refreshingRef.current || window.scrollY > 0 || event.touches.length !== 1) return;
      startY = event.touches[0].clientY;
      pulling = false;
    }

    function onTouchMove(event: TouchEvent) {
      if (startY === null) return;
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (pulling) y.set(0);
        pulling = false;
        return;
      }
      pulling = true;
      if (event.cancelable) event.preventDefault();
      // Resistance curve.
      const value = Math.min(MAX_PULL, dy * 0.5);
      y.set(value);
      const nowArmed = value >= TRIGGER;
      if (nowArmed !== isArmed) {
        isArmed = nowArmed;
        setArmed(nowArmed);
        if (nowArmed) haptic("light");
      }
    }

    async function onTouchEnd() {
      if (startY === null) return;
      startY = null;
      if (!pulling) return;
      pulling = false;
      if (isArmed) {
        isArmed = false;
        setArmed(false);
        refreshingRef.current = true;
        setRefreshing(true);
        to(HOLD);
        try {
          await onRefreshRef.current();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
          to(0);
        }
      } else {
        to(0);
      }
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, reduced, y]);

  if (!enabled) return <div className={className}>{children}</div>;

  return (
    <div className={cn("relative", className)}>
      <m.div
        aria-hidden={!refreshing}
        style={{ opacity: indicatorOpacity, y: indicatorY }}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
      >
        <span className="flex size-9 items-center justify-center rounded-full border border-border-strong bg-surface text-fg-muted shadow-float">
          {refreshing ? (
            <Spinner label="Actualisation" />
          ) : (
            <m.span style={{ rotate: arrowRotate }} className="flex">
              <ArrowDown className="size-4" aria-hidden />
            </m.span>
          )}
        </span>
      </m.div>
      <span className="sr-only" aria-live="polite">
        {refreshing ? "Actualisation…" : armed ? "Relâche pour actualiser" : ""}
      </span>
      <m.div style={{ y }}>{children}</m.div>
    </div>
  );
}
