import { ChevronDown, Link2, RefreshCw, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


type DiscoverServer = {
  name: string;
  command?: string | null;
};

export type MCPDiscoveryHit = {
  brand: string;
  display_name: string;
  icon: string;
  path: string;
  format: string;
  exists: boolean;
  parse_ok: boolean;
  server_count: number;
  servers: DiscoverServer[];
  parse_error?: string | null;
};

type Props = {
  loading: boolean;
  hits: MCPDiscoveryHit[];
  onRefresh: () => Promise<void>;
  onImport: (hit: MCPDiscoveryHit) => Promise<void>;
  onLinkOnly: (hit: MCPDiscoveryHit) => Promise<void>;
  onOpenPath: (path: string) => Promise<void>;
};

export function MCPDiscoveryPanel({ loading, hits, onRefresh, onImport, onLinkOnly, onOpenPath }: Props) {
  const { t } = useTranslation("settings");
  const [menuBrand, setMenuBrand] = useState<string | null>(null);
  const sortedHits = useMemo(
    () => [...hits].sort((a, b) => Number(b.exists) - Number(a.exists) || a.display_name.localeCompare(b.display_name)),
    [hits],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-text-faint">{st("mcpRemote.scanHint")}</div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {st("mcpRemote.rescan")}
        </button>
      </div>

      {sortedHits.length === 0 ? (
        <div className="rounded-md border border-border bg-surface-panel px-3 py-4 text-sm text-text-faint">{st("mcpRemote.noScan")}</div>
      ) : (
        <div className="space-y-2">
          {sortedHits.map((hit) => (
            <div key={`${hit.brand}-${hit.path}`} className="rounded-md border border-border bg-surface-card px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-muted">
                    {hit.display_name}
                    <span className="ml-2 text-[11px] text-text-faint">{st("mcpRemote.serverCount", { count: hit.server_count })}</span>
                  </div>
                  <div className="truncate text-[11px] text-text-faint">{hit.path}</div>
                  {!hit.exists ? (
                    <div className="mt-1 text-[11px] text-amber-400">{st("mcpRemote.notFound")}</div>
                  ) : hit.parse_ok ? (
                    <div className="mt-1 text-[11px] text-emerald-400">{st("mcpRemote.readable")}</div>
                  ) : (
                    <div className="mt-1 text-[11px] text-rose-400">{st("mcpRemote.parseFailed", { error: hit.parse_error || st("mcpRemote.unknownError") })}</div>
                  )}
                </div>
                <div className="relative flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md bg-[var(--settings-accent-solid)] px-2 py-1 text-xs text-[var(--settings-accent-solid-text)] disabled:opacity-40"
                    onClick={() => void onImport(hit)}
                    disabled={!hit.exists || hit.format === "detect-only"}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {st("mcpRemote.import")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border p-1 text-text-subtle transition hover:bg-surface-hover"
                    onClick={() => setMenuBrand((prev) => (prev === hit.brand ? null : hit.brand))}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {menuBrand === hit.brand ? (
                    <div className="absolute right-0 top-8 z-10 w-40 rounded-md border border-border bg-surface-panel p-1 text-xs shadow-xl">
                      <button
                        type="button"
                        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left hover:bg-surface-hover"
                        disabled={!hit.exists}
                        onClick={() => {
                          setMenuBrand(null);
                          void onLinkOnly(hit);
                        }}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {st("mcpRemote.linkOnly")}
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left hover:bg-surface-hover"
                        disabled={!hit.exists}
                        onClick={() => {
                          setMenuBrand(null);
                          void onOpenPath(hit.path);
                        }}
                      >
                        {st("mcpRemote.openFile")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              {hit.servers.length > 0 ? (
                <div className="mt-1 text-[11px] text-text-faint">
                  {hit.servers.slice(0, 3).map((s) => s.name).join("、")}
                  {hit.servers.length > 3 ? "..." : ""}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
