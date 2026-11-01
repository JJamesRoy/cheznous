"use client";

import Link from "next/link";
import { Button } from "@/components/ui";
import { useSession } from "@/features/app/session";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { Panel, SettingsSection } from "./section";

export function AccountSection() {
  const { user } = useSession();
  return (
    <SettingsSection id="compte" title="Compte">
      <Panel>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-fg-subtle">Courriel</span>
          <span className="text-base break-all text-fg">{user.email}</span>
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
          <Button asChild variant="secondary">
            <Link href="/mot-de-passe?next=%2Freglages">Changer le mot de passe</Link>
          </Button>
          <SignOutButton variant="secondary" size="md" className="text-negative">
            Se déconnecter
          </SignOutButton>
        </div>
      </Panel>
    </SettingsSection>
  );
}
