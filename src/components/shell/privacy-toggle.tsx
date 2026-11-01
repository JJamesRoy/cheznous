"use client";

import { Eye, EyeOff } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useModKeyLabel } from "@/lib/ui/use-hotkeys";
import { usePrivacy } from "@/lib/ui/privacy";
import { cn } from "@/lib/ui/cn";

/**
 * Eye toggle for privacy mode. Icon swap is CSS-driven (html[data-privacy])
 * so it is right on first paint.
 */
export function PrivacyToggle({ className, size = "icon" }: { className?: string; size?: "icon" | "icon-sm" }) {
  const { masked, toggle } = usePrivacy();
  const mod = useModKeyLabel();
  return (
    <Tooltip content={masked ? "Afficher les montants" : "Masquer les montants"} shortcut={[mod, "⇧", "H"]}>
      <IconButton
        label="Masquer les montants"
        aria-pressed={masked}
        onClick={toggle}
        size={size}
        className={cn("text-fg-muted hover:text-fg", className)}
      >
        <Eye data-privacy-icon="off" aria-hidden />
        <EyeOff data-privacy-icon="on" aria-hidden />
      </IconButton>
    </Tooltip>
  );
}
