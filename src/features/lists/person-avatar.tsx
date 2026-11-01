"use client";

import { Avatar } from "@/components/ui";
import { usePersonTone } from "@/lib/ui/people";

/** Assignee / author avatar for lists, tasks and notes, in the person's stable hue. */
export function PersonAvatar({
  userId,
  name,
  size = "sm",
  className,
  decorative = false,
}: {
  userId: string;
  name: string;
  size?: "sm" | "md";
  className?: string;
  decorative?: boolean;
}) {
  const tone = usePersonTone(userId);
  return <Avatar name={name} size={size} decorative={decorative} className={className} tone={tone.key} />;
}
