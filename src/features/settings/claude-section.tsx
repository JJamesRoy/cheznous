"use client";

import { Check, Copy } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, ConfirmDialog, IconButton, Skeleton, toast } from "@/components/ui";
import { useOp } from "@/lib/data/query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/ui/cn";
import { InlineError, Panel, SettingsSection } from "./section";

const timeFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "America/Toronto",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Toronto", day: "numeric", month: "short", year: "numeric" });

const STATUS_LABEL: Record<string, string> = { ok: "Réussi", preview: "Aperçu", error: "Erreur" };

export function ClaudeSection() {
  const [endpoint, setEndpoint] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- origin is only known in the browser
    setEndpoint(`${window.location.origin}/api/mcp`);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Copie impossible : sélectionne l'adresse et copie-la à la main.");
    }
  }

  return (
    <SettingsSection
      id="claude"
      title="Claude"
      description="Ajoute Chez Nous comme connecteur dans Claude pour noter une dépense ou consulter le budget en conversation."
    >
      <Panel>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" id="mcp-endpoint-label">
              Adresse du serveur MCP
            </span>
            <div className="flex min-w-0 items-center gap-1 rounded-control bg-surface-2 py-1 pr-1 pl-3">
              <input
                readOnly
                value={endpoint}
                aria-labelledby="mcp-endpoint-label"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 truncate bg-transparent font-mono text-sm text-fg focus-visible:outline-none"
              />
              <IconButton label={copied ? "Adresse copiée" : "Copier l'adresse"} size="icon-sm" onClick={copy} disabled={!endpoint}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </IconButton>
            </div>
          </div>
          <ol className="flex flex-col gap-2.5 text-base text-fg">
            {[
              "Dans Claude, ouvre Paramètres, puis Connecteurs.",
              "Choisis « Ajouter un connecteur personnalisé » et colle l'adresse ci-dessus.",
              "Connecte-toi à Chez Nous et accepte l'accès : Claude agira en ton nom, sans pouvoir rien supprimer.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="num w-4 shrink-0 text-fg-subtle">{i + 1}.</span>
                <span className="text-pretty">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </Panel>
      <Grants />
      <RecentCalls />
    </SettingsSection>
  );
}

function Grants() {
  const qc = useQueryClient();
  const grants = useQuery({
    queryKey: ["oauth-grants"],
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().auth.oauth.listGrants();
      if (error) throw error;
      return data;
    },
    retry: false,
  });
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (grants.isError) return null; // OAuth server not enabled on this project: nothing to manage.
  return (
    <Panel padded={false}>
      <div className="px-4 pt-4 pb-2 md:px-5">
        <h3 className="text-sm font-medium">Applications autorisées</h3>
      </div>
      {grants.isPending ? (
        <div className="px-4 pb-4 md:px-5" aria-busy>
          <Skeleton className="h-11 w-full" />
        </div>
      ) : grants.data.length === 0 ? (
        <p className="px-4 pb-4 text-base text-fg-muted md:px-5">Aucune application n&apos;a accès à ton compte.</p>
      ) : (
        <ul>
          {grants.data.map((g) => (
            <li key={g.client.id} className="flex min-h-[52px] items-center gap-3 border-t border-border py-2 pr-2 pl-4 md:pl-5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base">{g.client.name || "Application sans nom"}</span>
                <span className="text-sm text-fg-subtle">Autorisée le {dayFmt.format(new Date(g.granted_at))}</span>
              </div>
              <Button variant="danger-ghost" size="sm" onClick={() => setRevoking({ id: g.client.id, name: g.client.name || "cette application" })}>
                Retirer l&apos;accès
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="px-4 pb-4 md:px-5">
          <InlineError>{error}</InlineError>
        </div>
      ) : null}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Retirer l'accès de ${revoking?.name ?? ""} ?`}
        description="L'application ne pourra plus lire ni modifier tes données. Tu pourras la reconnecter plus tard."
        confirmLabel="Retirer l'accès"
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          setError(null);
          const { error } = await getBrowserSupabase().auth.oauth.revokeGrant({ clientId: revoking.id });
          if (error) setError("Impossible de retirer l'accès. Réessaie.");
          else toast(`Accès retiré à ${revoking.name}`);
          await qc.invalidateQueries({ queryKey: ["oauth-grants"] });
        }}
      />
    </Panel>
  );
}

function RecentCalls() {
  const calls = useOp("mcp.recentCalls", { limit: 10 });
  return (
    <Panel padded={false}>
      <div className="px-4 pt-4 pb-2 md:px-5">
        <h3 className="text-sm font-medium">Derniers appels de Claude</h3>
      </div>
      {calls.isPending ? (
        <div aria-busy>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex h-11 items-center gap-3 border-t border-border px-4 md:px-5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </div>
      ) : calls.error ? (
        <div role="alert" className="flex flex-col items-start gap-2 px-4 pb-4 md:px-5">
          <p className="text-base text-fg-muted">{calls.error.message}</p>
          <Button variant="secondary" size="sm" onClick={() => calls.refetch()}>
            Réessayer
          </Button>
        </div>
      ) : calls.data.calls.length === 0 ? (
        <p className="px-4 pb-4 text-base text-fg-muted md:px-5">Aucun appel pour l&apos;instant. Ils apparaîtront ici dès que Claude utilisera Chez Nous.</p>
      ) : (
        <ul>
          {calls.data.calls.map((c) => (
            <li key={c.id} className="flex min-h-11 items-center gap-3 border-t border-border px-4 py-2 text-sm md:px-5">
              <span className="min-w-0 flex-1 truncate font-mono text-fg">{c.tool}</span>
              <span className={cn("shrink-0", c.status === "error" ? "text-negative" : "text-fg-muted")}>
                {STATUS_LABEL[c.status] ?? c.status}
                {c.status === "error" && c.error_code ? <span className="font-mono"> · {c.error_code}</span> : null}
              </span>
              <time dateTime={c.at} className="num w-28 shrink-0 text-right text-fg-subtle">
                {timeFmt.format(new Date(c.at))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
