"use client";

import { Command } from "cmdk";
import { CornerDownLeft, Eye, FileText, Monitor, Moon, Search, Sun, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { usePrivacy } from "@/lib/ui/privacy";
import { useTheme } from "@/lib/ui/theme";
import { NAV_ITEMS } from "./nav";

export type CommandAction = {
  id: string;
  label: string;
  /** Display hint, e.g. "N". */
  shortcut?: string;
  icon?: LucideIcon;
  /** Extra words that should match (synonyms). */
  keywords?: string[];
  run: () => void;
};

export type CommandSearchResult = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  icon?: LucideIcon;
};

export type CommandMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: CommandAction[];
  /** Async search (e.g. notes). Called debounced with the current query. */
  search?: (query: string, signal: AbortSignal) => Promise<CommandSearchResult[]>;
  /** Heading for search results. */
  searchLabel?: string;
};

const itemClasses =
  "flex h-11 cursor-default items-center gap-3 rounded-control px-3 text-input text-fg select-none md:h-9 [&_svg]:size-4 [&_svg]:shrink-0";

/** ⌘K palette: navigation, actions, preferences and optional async search. */
export function CommandMenu({
  open,
  onOpenChange,
  actions = [],
  search,
  searchLabel = "Notes",
}: CommandMenuProps) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { masked, toggle } = usePrivacy();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const trimmed = query.trim();

  useEffect(() => {
    if (!search || !trimmed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      search(trimmed, controller.signal)
        .then((found) => {
          if (!controller.signal.aborted) setResults(found);
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [search, trimmed]);

  function handleQueryChange(next: string) {
    setQuery(next);
    if (search && next.trim()) setLoading(true);
    else {
      setLoading(false);
      setResults([]);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setResults([]);
      setLoading(false);
    }
    onOpenChange(next);
  }

  function run(fn: () => void) {
    handleOpenChange(false);
    fn();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        title="Commandes"
        description="Rechercher une page, une action ou une note"
        hideTitle
        placement="top"
        className="max-w-[560px]"
      >
        <Command className="cn-command flex min-h-0 flex-col" loop label="Commandes">
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <Command.Input
              value={query}
              onValueChange={handleQueryChange}
              placeholder="Rechercher ou lancer une commande…"
              className="h-12 min-w-0 flex-1 bg-transparent text-input text-fg outline-none placeholder:text-placeholder"
            />
            {loading ? <Spinner className="text-fg-subtle" label="Recherche" /> : null}
            <Kbd className="hidden md:inline-flex">Esc</Kbd>
          </div>
          <Command.List className="max-h-[min(440px,60dvh)] overflow-y-auto overscroll-contain p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-base text-fg-muted">
              {loading ? "Recherche…" : "Aucun résultat."}
            </Command.Empty>

            {search && trimmed && results.length > 0 ? (
              <Command.Group heading={searchLabel}>
                {results.map((result) => {
                  const Icon = result.icon ?? FileText;
                  return (
                    <Command.Item
                      key={result.id}
                      value={`search:${result.id}:${result.title}`}
                      forceMount
                      onSelect={() => run(() => router.push(result.href))}
                      className={itemClasses}
                    >
                      <Icon className="text-fg-subtle" aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{result.title}</span>
                        {result.subtitle ? (
                          <span className="truncate text-sm text-fg-subtle">{result.subtitle}</span>
                        ) : null}
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ) : null}

            {actions.length > 0 ? (
              <Command.Group heading="Actions">
                {actions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Command.Item
                      key={action.id}
                      value={`action:${action.id}:${action.label}`}
                      keywords={action.keywords}
                      onSelect={() => run(action.run)}
                      className={itemClasses}
                    >
                      {Icon ? <Icon className="text-fg-subtle" aria-hidden /> : <span className="size-4" />}
                      <span className="flex-1 truncate">{action.label}</span>
                      {action.shortcut ? <Kbd className="hidden md:inline-flex">{action.shortcut}</Kbd> : null}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ) : null}

            <Command.Group heading="Navigation">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item
                    key={item.href}
                    value={`nav:${item.href}:${item.label}`}
                    keywords={["aller", "page"]}
                    onSelect={() => run(() => router.push(item.href))}
                    className={itemClasses}
                  >
                    <Icon className="text-fg-subtle" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.goKey ? (
                      <span className="hidden gap-0.5 md:flex">
                        <Kbd>G</Kbd>
                        <Kbd>{item.goKey.toUpperCase()}</Kbd>
                      </span>
                    ) : null}
                  </Command.Item>
                );
              })}
            </Command.Group>

            <Command.Group heading="Préférences">
              <Command.Item
                value="pref:privacy"
                keywords={["montants", "masquer", "afficher", "confidentialité"]}
                onSelect={() => run(toggle)}
                className={itemClasses}
              >
                <Eye className="text-fg-subtle" aria-hidden />
                <span className="flex-1 truncate">
                  {masked ? "Afficher les montants" : "Masquer les montants"}
                </span>
              </Command.Item>
              <Command.Item
                value="pref:theme-light"
                keywords={["thème", "clair", "apparence"]}
                onSelect={() => run(() => setTheme("light"))}
                className={itemClasses}
              >
                <Sun className="text-fg-subtle" aria-hidden />
                <span className="flex-1 truncate">Thème clair</span>
              </Command.Item>
              <Command.Item
                value="pref:theme-dark"
                keywords={["thème", "sombre", "apparence"]}
                onSelect={() => run(() => setTheme("dark"))}
                className={itemClasses}
              >
                <Moon className="text-fg-subtle" aria-hidden />
                <span className="flex-1 truncate">Thème sombre</span>
              </Command.Item>
              <Command.Item
                value="pref:theme-system"
                keywords={["thème", "système", "automatique", "apparence"]}
                onSelect={() => run(() => setTheme("system"))}
                className={itemClasses}
              >
                <Monitor className="text-fg-subtle" aria-hidden />
                <span className="flex-1 truncate">Thème du système</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="hidden items-center justify-end gap-4 border-t border-border px-4 py-2 text-xs text-fg-subtle md:flex">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              naviguer
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>
                <CornerDownLeft className="size-3" aria-hidden />
              </Kbd>
              ouvrir
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
