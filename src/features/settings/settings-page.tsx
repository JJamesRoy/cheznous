"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { PageHeader } from "@/components/shell";
import { opKey } from "@/lib/data/query";
import { AccountSection } from "./account-section";
import { AppearanceSection } from "./appearance-section";
import { CategoriesSection } from "./categories-section";
import { ClaudeSection } from "./claude-section";
import { HouseholdSection, PartnerSection, SplitSection } from "./household-sections";
import { NotificationsSection } from "./notifications-section";
import { ProfileSection } from "./profile-section";

export function SettingsPage() {
  const qc = useQueryClient();
  // Household settings aren't pushed by Realtime: always show fresh values here.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: opKey("session.get") });
  }, [qc]);
  return (
    <div className="mx-auto w-full max-w-[960px]">
      <PageHeader title="Réglages" />
      <div className="flex flex-col gap-10 pb-16 md:gap-12">
        <ProfileSection />
        <HouseholdSection />
        <PartnerSection />
        <SplitSection />
        <CategoriesSection />
        <AppearanceSection />
        <NotificationsSection />
        <ClaudeSection />
        <AccountSection />
      </div>
    </div>
  );
}
