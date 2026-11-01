"use client";

import { Kbd } from "@/components/ui/kbd";
import { Sheet } from "@/components/ui/sheet";
import { useModKeyLabel } from "@/lib/ui/use-hotkeys";

type Shortcut = { label: string; keys: string[][] };

/** "?" sheet listing every keyboard shortcut. */
export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mod = useModKeyLabel();
  const groups: { title: string; items: Shortcut[] }[] = [
    {
      title: "Général",
      items: [
        { label: "Nouvelle dépense", keys: [["N"]] },
        { label: "Rechercher", keys: [["/"]] },
        { label: "Commandes", keys: [[mod, "K"]] },
        { label: "Masquer les montants", keys: [[mod, "⇧", "H"]] },
        { label: "Aide", keys: [["?"]] },
      ],
    },
    {
      title: "Aller à",
      items: [
        { label: "Accueil", keys: [["G"], ["D"]] },
        { label: "Dépenses", keys: [["G"], ["E"]] },
        { label: "Budget", keys: [["G"], ["B"]] },
        { label: "Listes", keys: [["G"], ["L"]] },
        { label: "Tâches", keys: [["G"], ["T"]] },
        { label: "Notes", keys: [["G"], ["N"]] },
        { label: "Condo", keys: [["G"], ["C"]] },
      ],
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Raccourcis clavier" desktop="dialog">
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="pb-1 text-sm font-medium text-fg-subtle">{group.title}</h3>
            <dl className="flex flex-col">
              {group.items.map((item) => (
                <div
                  key={item.label}
                  className="flex min-h-10 items-center justify-between gap-4 border-b border-border last:border-b-0"
                >
                  <dt className="text-base text-fg">{item.label}</dt>
                  <dd className="flex items-center gap-1.5 text-xs text-fg-subtle">
                    {item.keys.map((combo, index) => (
                      <span key={combo.join("+")} className="flex items-center gap-1.5">
                        {index > 0 ? <span>puis</span> : null}
                        <span className="flex gap-0.5">
                          {combo.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </span>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
