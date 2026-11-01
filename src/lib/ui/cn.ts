import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know about our custom theme scales so that e.g.
 * `text-md` (a font size) is not treated as a text color and dropped.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["xs", "sm", "base", "md", "lg", "xl", "2xl", "display", "input"],
      radius: ["control", "card", "sheet"],
      shadow: ["float"],
      ease: ["snappy", "io", "out", "in-out"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
