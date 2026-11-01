"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";
import { IconButton, Input, type InputProps } from "@/components/ui";

/** Password field with a show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, "type" | "trailing">>(function PasswordInput(
  props,
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      ref={ref}
      {...props}
      type={visible ? "text" : "password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <IconButton
          label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          size="icon-sm"
          className="text-fg-subtle"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </IconButton>
      }
    />
  );
});
