import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createBrainsApi, type BrainRecord } from "../brains/api";
import { createKbApi } from "./api";
import { KnowledgeWikiPanel } from "./KnowledgeWikiPanel";
import { useAppStore } from "../../../store";

export function WikiNavPanel() {
  const { t } = useTranslation("settings");
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);
  const brainsApi = useMemo(
    () => createBrainsApi(apiToken, resolveApiBase),
    [apiToken, resolveApiBase],
  );
  const [brains, setBrains] = useState<BrainRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = (await brainsApi.list()).filter((brain) => brain.type === "docs");
        if (cancelled) return;
        setBrains(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      } catch (exc) {
        if (!cancelled) setError(String((exc as Error).message ?? exc));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brainsApi]);

  const kbApi = useMemo(() => {
    if (!selectedId) return null;
    return createKbApi(
      apiToken,
      async () => {
        const base = await resolveApiBase();
        return `${base}/api/brains/${encodeURIComponent(selectedId)}`;
      },
      "brain",
    );
  }, [apiToken, resolveApiBase, selectedId]);

  if (error) {
    return <p className="text-xs text-red-400">{error}</p>;
  }
  if (brains.length === 0) {
    return <p className="text-xs leading-relaxed text-text-muted">{t("knowledge.wikiEmpty")}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="flex w-52 shrink-0 flex-col gap-1 rounded-lg border border-border bg-surface-card p-2">
        {brains.map((brain) => (
          <button
            key={brain.id}
            type="button"
            className={`rounded-md px-2 py-1.5 text-left text-xs ${
              brain.id === selectedId
                ? "bg-surface-card-strong text-text-strong"
                : "text-text-muted hover:bg-surface-hover"
            }`}
            onClick={() => setSelectedId(brain.id)}
          >
            {brain.name}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        {kbApi ? <KnowledgeWikiPanel api={kbApi} /> : null}
      </div>
    </div>
  );
}
