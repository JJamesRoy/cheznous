"use client";

import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";

export type AvatarSize = "sm" | "md" | "lg";

const sizes: Record<AvatarSize, string> = {
  sm: "size-6 text-xs",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
};

// Neutral scale only: tone is derived from the name so it stays stable.
const tones = ["bg-gray-4 text-gray-12", "bg-gray-6 text-gray-12", "bg-gray-11 text-gray-1"];

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return tones[Math.abs(hash) % tones.length];
}

export function initials(name: string, max = 2): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (max === 1 ? first : first + last).toUpperCase();
}

export type AvatarProps = {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
  /** Decorative when the name is already shown next to it. */
  decorative?: boolean;
};

/** Round avatar: photo, or initials on a neutral tone. */
export function Avatar({ name, src, size = "md", className, decorative = false }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-full select-none",
        sizes[size],
        className,
      )}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : name}
      role={decorative ? undefined : "img"}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className={cn(
          "flex size-full items-center justify-center font-medium tracking-wide",
          toneFor(name),
        )}
      >
        {initials(name, size === "sm" ? 1 : 2)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/** Overlapping avatars (e.g. a shared item). */
export function AvatarStack({
  people,
  size = "sm",
  className,
}: {
  people: { name: string; avatarUrl?: string | null }[];
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span className={cn("flex -space-x-1.5", className)}>
      {people.map((person) => (
        <Avatar
          key={person.name}
          name={person.name}
          src={person.avatarUrl}
          size={size}
          className="ring-2 ring-bg"
        />
      ))}
    </span>
  );
}
