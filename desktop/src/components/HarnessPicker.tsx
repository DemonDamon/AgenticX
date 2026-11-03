import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Terminal } from "lucide-react";
import { useAppStore } from "../store";

/** Catalog entry returned by GET /api/harnesses (studio server, SP3). */
type HarnessCatalogEntry = {
  harness_id: string;
  display_name: string;
  description?: string;
  available: boolean;
  builtin?: boolean;
  capabilities?: Record<string, boolean>;
};

const BUILTIN_ID = "python-agent";

type Props = {
  paneId: string;
  apiBase: string;
  apiToken: string;
};

/**
 * Per-pane harness picker (harness-control-surface SP5a).
 *
 * Interaction mirrors PaneModelPicker: compact trigger in the composer
 * toolbar, fixed dropdown above it, active row highlighted, selection
 * persists via POST /api/sessions/{id}/harness when the pane is bound to
 * a session. Harnesses whose CLI is missing are grayed out (available=false).
 */
export function PaneHarnessPicker({ paneId, apiBase, apiToken }: Props) {
  const { t } = useTranslation("chat");
  const setPaneHarness = useAppStore((s) => s.setPaneHarness);
  const pane = useAppStore((s) => s.panes.find((p) => p.id === paneId));
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<HarnessCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentHarnessId = (pane?.harnessId || "").trim() || BUILTIN_ID;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const loadCatalog = useCallback(async () => {
    if (!apiBase) return;
    try {
      const resp = await fetch(`${apiBase.replace(/\/$/, "")}/api/harnesses`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as { harnesses?: HarnessCatalogEntry[] };
      setCatalog(Array.isArray(body.harnesses) ? body.harnesses : []);
      setLoadError(false);
    } catch {
      setCatalog(null);
      setLoadError(true);
    }
  }, [apiBase, apiToken]);

  useEffect(() => {
    if (open) void loadCatalog();
  }, [open, loadCatalog]);

  // Pre-warm the catalog on mount so a restored binding (cold restart)
  // resolves its display name instead of flashing the raw harness id.
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const handleSelect = (entry: HarnessCatalogEntry) => {
    const nextId = entry.harness_id === BUILTIN_ID ? null : entry.harness_id;
    setPaneHarness(paneId, nextId);
    setOpen(false);
    // Persist against the bound studio session so a cold restart + jump-back
    // restores the exact pick (same contract as PaneModelPicker).
    const sid = String(pane?.sessionId ?? "").trim();
    if (sid) {
      void window.agenticxDesktop.setSessionHarness({
        sessionId: sid,
        harnessId: entry.harness_id,
      });
    }
  };

  const currentEntry =
    catalog?.find((h) => h.harness_id === currentHarnessId) ?? null;
  const currentLabel = currentEntry
    ? currentEntry.display_name
    : currentHarnessId === BUILTIN_ID
      ? t("harness.builtin")
      : currentHarnessId;

  return (
    <div className="relative min-w-0 max-w-full" ref={anchorRef}>
      <button
        type="button"
        className={`group flex h-8 min-h-8 max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium leading-5 transition-colors focus:outline-none focus-visible:bg-surface-hover ${
          open ? "bg-surface-hover" : "hover:bg-surface-hover"
        }`}
        onClick={() => setOpen((v) => !v)}
        title={t("harness.tooltip")}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Terminal
          className="h-3.5 w-3.5 shrink-0 text-text-muted"
          strokeWidth={2}
          aria-hidden
        />
        <span className="min-w-0 truncate text-text-strong">{currentLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-fast ease-out ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div
              ref={panelRef}
              role="listbox"
              aria-label={t("harness.tooltip")}
              className="agx-menu-pop fixed z-40 flex max-h-[280px] w-[260px] flex-col overflow-y-auto rounded-2xl border border-border bg-surface-panel p-1.5 shadow-2xl backdrop-blur-xl"
              style={{
                left:
                  (anchorRef.current?.getBoundingClientRect().left ?? 0) - 40,
                bottom:
                  window.innerHeight -
                  (anchorRef.current?.getBoundingClientRect().top ?? 0) +
                  4,
              }}
            >
              {loadError ? (
                <div className="px-3 py-4 text-center text-[12px] text-text-muted">
                  {t("harness.loadFailed")}
                </div>
              ) : catalog == null ? (
                <div className="px-3 py-4 text-center text-[12px] text-text-muted">
                  {t("harness.loading")}
                </div>
              ) : catalog.length === 0 ? (
                <div className="px-3 py-4 text-center text-[12px] text-text-muted">
                  {t("harness.empty")}
                </div>
              ) : (
                catalog.map((entry) => {
                  const isActive = entry.harness_id === currentHarnessId;
                  const disabled = !entry.available;
                  return (
                    <button
                      key={entry.harness_id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      disabled={disabled}
                      title={
                        disabled
                          ? t("harness.unavailable")
                          : entry.description || entry.display_name
                      }
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] leading-5 transition-colors ${
                        isActive
                          ? "bg-surface-cardStrong"
                          : disabled
                            ? "cursor-not-allowed opacity-45"
                            : "hover:bg-surface-hover"
                      }`}
                      onClick={() => {
                        if (disabled) return;
                        handleSelect(entry);
                      }}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          disabled ? "bg-zinc-600" : "bg-emerald-500"
                        }`}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={`truncate ${isActive ? "font-semibold text-text-strong" : "text-text-standard"}`}
                        >
                          {entry.builtin ? t("harness.builtin") : entry.display_name}
                        </span>
                        {disabled ? (
                          <span className="truncate text-[11px] font-normal text-text-faint">
                            {t("harness.unavailable")}
                          </span>
                        ) : null}
                      </span>
                      {isActive ? (
                        <Check
                          className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                          strokeWidth={2.5}
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
