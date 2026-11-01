"use client";

import { Kbd, SegmentedControl, Switch } from "@/components/ui";
import { usePrivacy } from "@/lib/ui/privacy";
import { useTheme, type ThemePreference } from "@/lib/ui/theme";
import { Panel, SettingsSection } from "./section";

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { masked, setMasked } = usePrivacy();
  return (
    <SettingsSection id="apparence" title="Apparence" description="Propre à cet appareil.">
      <Panel>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Thème</span>
          <SegmentedControl<ThemePreference>
            aria-label="Thème"
            value={theme}
            onValueChange={setTheme}
            options={[
              { value: "light", label: "Clair" },
              { value: "dark", label: "Sombre" },
              { value: "system", label: "Système" },
            ]}
            className="sm:max-w-sm"
          />
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <Switch
            label="Masquer les montants"
            description={
              <>
                Affiche •••,•• $ partout, pratique en public. Raccourci <Kbd>⌘</Kbd>
                <Kbd>⇧</Kbd>
                <Kbd>H</Kbd>
              </>
            }
            checked={masked}
            onCheckedChange={setMasked}
          />
        </div>
      </Panel>
    </SettingsSection>
  );
}
