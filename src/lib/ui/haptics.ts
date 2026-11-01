/**
 * Haptic feedback for key confirmations (expense saved, settlement recorded,
 * item checked). Feature-detected: iOS Safari has no Vibration API and
 * nothing is faked there.
 */
export type HapticKind = "light" | "success" | "warning";

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8,
  success: [8, 48, 12],
  warning: [16, 64, 16],
};

export function haptic(kind: HapticKind = "light"): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some browsers throw when called without a user gesture: ignore.
  }
}
