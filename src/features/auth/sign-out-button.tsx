"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui";
import { signOutAndLeave } from "./sign-out";

export function SignOutButton({ children = "Se déconnecter", ...props }: Omit<ButtonProps, "onClick" | "loading">) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      {...props}
      loading={busy}
      onClick={() => {
        setBusy(true);
        void signOutAndLeave();
      }}
    >
      {children}
    </Button>
  );
}
