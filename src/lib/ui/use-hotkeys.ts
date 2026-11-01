"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Keyboard shortcuts.
 *
 * Key syntax (case-insensitive):
 * - single keys: `"n"`, `"/"`, `"?"`, `"escape"`
 * - modifiers: `"mod+k"` (⌘ on Apple, Ctrl elsewhere), `"ctrl+k"`, `"meta+k"`,
 *   `"alt+n"`, `"shift+n"`, `"mod+shift+h"`
 * - sequences: `"g d"` (second key within 800ms)
 *
 * Bindings are ignored while typing in inputs, textareas, selects and
 * contenteditable — except Escape and `mod+k` (or bindings with `allowInInputs`).
 */
export type HotkeyHandler = (event: KeyboardEvent) => void;

export type HotkeyBinding = {
  keys: string;
  handler: HotkeyHandler;
  /** Fire even while focus is in a text field. */
  allowInInputs?: boolean;
  /** Call preventDefault (default true). */
  preventDefault?: boolean;
};

export type HotkeyMap = Record<string, HotkeyHandler>;

type ParsedCombo = {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

const SEQUENCE_TIMEOUT = 800;

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+");
  // "shift++" style is not supported; "+" itself is not a binding we need.
  const rawKey = parts.pop() ?? "";
  const key = KEY_ALIASES[rawKey] ?? rawKey;
  return {
    key,
    mod: parts.includes("mod"),
    ctrl: parts.includes("ctrl"),
    meta: parts.includes("meta") || parts.includes("cmd"),
    alt: parts.includes("alt") || parts.includes("option"),
    shift: parts.includes("shift"),
  };
}

function eventKeys(event: KeyboardEvent): string[] {
  const keys = [event.key.toLowerCase()];
  // With Alt/Option or some layouts, event.key is not the letter: use the code.
  const code = event.code;
  if (code.startsWith("Key")) keys.push(code.slice(3).toLowerCase());
  else if (code.startsWith("Digit")) keys.push(code.slice(5));
  return keys;
}

function isLetterOrDigit(key: string): boolean {
  return /^[a-z0-9]$/.test(key);
}

function matches(combo: ParsedCombo, event: KeyboardEvent, apple: boolean): boolean {
  if (!eventKeys(event).includes(combo.key)) return false;
  const wantMeta = combo.meta || (combo.mod && apple);
  const wantCtrl = combo.ctrl || (combo.mod && !apple);
  if (event.metaKey !== wantMeta) return false;
  if (event.ctrlKey !== wantCtrl) return false;
  if (event.altKey !== combo.alt) return false;
  // Shift matters for letters/digits ("n" ≠ "N"); symbols like "?" already
  // encode it in event.key.
  if (isLetterOrDigit(combo.key) || combo.shift) {
    if (event.shiftKey !== combo.shift) return false;
  }
  return true;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(type);
  }
  return target.getAttribute("role") === "textbox";
}

function alwaysAllowed(combo: ParsedCombo): boolean {
  return combo.key === "escape" || (combo.key === "k" && (combo.mod || combo.meta || combo.ctrl));
}

type CompiledBinding = {
  steps: ParsedCombo[];
  binding: HotkeyBinding;
};

function compile(bindings: HotkeyBinding[]): CompiledBinding[] {
  return bindings.map((binding) => ({
    steps: binding.keys.trim().split(/\s+/).map(parseCombo),
    binding,
  }));
}

function normalize(bindings: HotkeyBinding[] | HotkeyMap): HotkeyBinding[] {
  if (Array.isArray(bindings)) return bindings;
  return Object.entries(bindings).map(([keys, handler]) => ({ keys, handler }));
}

export function useHotkeys(
  bindings: HotkeyBinding[] | HotkeyMap,
  options: { enabled?: boolean } = {},
): void {
  const { enabled = true } = options;
  const latest = useRef<CompiledBinding[]>([]);

  useEffect(() => {
    latest.current = compile(normalize(bindings));
  });

  useEffect(() => {
    if (!enabled) return;
    const apple = isApple();
    let pending: { combo: ParsedCombo; at: number } | null = null;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      const editable = isEditableTarget(event.target);
      const compiled = latest.current;
      const now = Date.now();

      const allowed = (c: CompiledBinding) =>
        !editable || c.binding.allowInInputs || c.steps.every(alwaysAllowed);

      const fire = (c: CompiledBinding) => {
        if (c.binding.preventDefault !== false) event.preventDefault();
        c.binding.handler(event);
      };

      // 1. Complete a pending sequence.
      if (pending && now - pending.at <= SEQUENCE_TIMEOUT) {
        const first = pending.combo;
        const hit = compiled.find(
          (c) =>
            c.steps.length === 2 &&
            allowed(c) &&
            c.steps[0].key === first.key &&
            matches(c.steps[1], event, apple),
        );
        pending = null;
        if (hit) {
          fire(hit);
          return;
        }
      }
      pending = null;

      // 2. Single-step bindings.
      const single = compiled.find(
        (c) => c.steps.length === 1 && allowed(c) && matches(c.steps[0], event, apple),
      );
      if (single) {
        fire(single);
        return;
      }

      // 3. Start a sequence.
      const starter = compiled.find(
        (c) => c.steps.length === 2 && allowed(c) && matches(c.steps[0], event, apple),
      );
      if (starter) pending = { combo: starter.steps[0], at: now };
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** Display label for a modifier, platform-aware ("⌘" or "Ctrl"). */
export function modKeyLabel(): string {
  return isApple() ? "⌘" : "Ctrl";
}

const noopSubscribe = () => () => {};

/** Hydration-safe modifier label for shortcut hints. */
export function useModKeyLabel(): string {
  return useSyncExternalStore(noopSubscribe, modKeyLabel, () => "⌘");
}
