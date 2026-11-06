import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Terminal } from "lucide-react";
import { useAppStore } from "../store";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "../utils/session-message-map";
import {
  BUILTIN_HARNESS_ID,
  normalizePreferredHarnessId,
  switchSessionHarnessWithFallback,
  toStoredPreferredHarnessId,
} from "../utils/preferred-harness";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "./ds/settings-typography";
import { SettingsDropdown, type SettingsDropdownOption } from "./ds/SettingsDropdown";

/** Catalog entry returned by GET /api/harnesses (studio server). */
export type HarnessCatalogEntry = {
  harness_id: string;
  display_name: string;
  description?: string;
  available: boolean;
  builtin?: boolean;
  capabilities?: Record<string, boolean>;
};

type SettingsProps = {
  apiBase: string;
  apiToken: string;
};

/**
 * Settings → General Preferences harness enum (compact SettingsDropdown).
 *
 * Same row layout as language / appearance. Persists the global default
 * for new sessions (and for chats that still follow the default).
 * Unavailable CLIs stay in the menu as disabled options (fail-closed).
 */
export function PreferredHarnessPicker({ apiBase, apiToken }: SettingsProps) {
  const { t } = useTranslation("settings");
  const preferredHarnessId = useAppStore((s) => s.preferredHarnessId);
  const setPreferredHarnessId = useAppStore((s) => s.setPreferredHarnessId);
  const [catalog, setCatalog] = useState<HarnessCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const currentHarnessId = normalizePreferredHarnessId(preferredHarnessId);

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
    void loadCatalog();
  }, [loadCatalog]);

  const options: SettingsDropdownOption[] = useMemo(() => {
    if (!catalog) return [];
    return catalog.map((entry) => {
      const name = entry.builtin ? t("harness.builtin") : entry.display_name;
      if (entry.available) {
        return { value: entry.harness_id, label: name };
      }
      return {
        value: entry.harness_id,
        label: t("harness.unavailableOption", { name }),
        disabled: true,
      };
    });
  }, [catalog, t]);

  const displayLabel = useMemo(() => {
    if (loadError) return t("harness.loadFailed");
    if (catalog == null) return t("harness.loading");
    if (options.length === 0) return t("harness.empty");
    const hit = options.find((opt) => opt.value === currentHarnessId);
    if (hit) {
      // Trigger shows clean name even when option label includes unavailable suffix.
      const entry = catalog.find((h) => h.harness_id === currentHarnessId);
      if (entry?.builtin) return t("harness.builtin");
      if (entry) return entry.display_name;
      return hit.label;
    }
    return t("harness.builtin");
  }, [catalog, currentHarnessId, loadError, options, t]);

  const handleChange = (next: string) => {
    const entry = catalog?.find((h) => h.harness_id === next);
    if (!entry || !entry.available) return;
    setPreferredHarnessId(toStoredPreferredHarnessId(next));
  };

  return (
    <div className="flex min-h-14 items-center justify-between gap-6 py-1">
      <div className="min-w-0">
        <div className={SETTINGS_LABEL_CLASS}>{t("harness.title")}</div>
        <div className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{t("harness.hint")}</div>
      </div>
      <SettingsDropdown
        value={currentHarnessId}
        displayLabel={displayLabel}
        options={options}
        onChange={handleChange}
        className="w-52 shrink-0"
        size="compact"
        menuPortal
        disabled={loadError || catalog == null || options.length === 0}
        title={t("harness.title")}
      />
    </div>
  );
}

type PaneProps = {
  paneId: string;
  apiBase: string;
  apiToken: string;
  disabled?: boolean;
};

/**
 * Per-pane composer harness picker.
 *
 * Shows the engine bound to *this* chat and switches it immediately via
 * `switchSessionHarness` (handoff + CLI restart, with metadata-rebind
 * fallback). Does not change the Settings default. Picking a different
 * engine than the default pins the session so a later Settings change
 * will not overwrite it.
 */
export function PaneHarnessPicker({ paneId, apiBase, apiToken, disabled = false }: PaneProps) {
  const { t } = useTranslation("chat");
  const setPaneHarness = useAppStore((s) => s.setPaneHarness);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const preferredHarnessId = useAppStore((s) => s.preferredHarnessId);
  const pane = useAppStore((s) => s.panes.find((p) => p.id === paneId));
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<HarnessCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentHarnessId = (pane?.harnessId || "").trim() || BUILTIN_HARNESS_ID;
  const triggerLocked = switching || disabled;

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

  const refreshPaneMessages = useCallback(
    async (sid: string) => {
      try {
        const result = await window.agenticxDesktop.loadSessionMessages(sid);
        if (!result.ok || !Array.isArray(result.messages)) return;
        const state = useAppStore.getState();
        const targets = state.panes.filter(
          (p) => String(p.sessionId ?? "").trim() === sid,
        );
        if (targets.length === 0) return;
        const mapped = result.messages.map((item, idx) =>
          mapLoadedSessionMessage(item as LoadedSessionMessage, sid, idx),
        );
        for (const target of targets) {
          setPaneMessages(target.id, mapped);
        }
      } catch {
        // keep current pane state; next natural reload will recover
      }
    },
    [setPaneMessages],
  );

  const handleSelect = (entry: HarnessCatalogEntry) => {
    const previousId = (pane?.harnessId || "").trim() || null;
    const nextId = toStoredPreferredHarnessId(entry.harness_id);
    setOpen(false);
    if (nextId === previousId) return;
    const follows =
      toStoredPreferredHarnessId(nextId) ===
      toStoredPreferredHarnessId(preferredHarnessId);
    // Optimistic local flip; the switch call below is authoritative.
    setPaneHarness(paneId, nextId, follows);
    const sid = String(pane?.sessionId ?? "").trim();
    if (!sid) return;
    setSwitching(true);
    setSwitchError(null);
    void switchSessionHarnessWithFallback(sid, nextId, {
      switchSessionHarness: (payload) => window.agenticxDesktop.switchSessionHarness(payload),
      setSessionHarness: (payload) => window.agenticxDesktop.setSessionHarness(payload),
    })
      .then(async (resp) => {
        if (!resp.ok) {
          // Fail closed: the server kept the previous binding — mirror it
          // locally and surface why (busy 409 / plan failure 400 / ...).
          setPaneHarness(paneId, previousId, pane?.harnessFollowsPreference);
          const detail = String(resp.error ?? "").trim();
          const busy = detail.includes("409") || detail.includes("in flight") || detail.includes("busy");
          setSwitchError(busy ? t("harness.switchBusy") : t("harness.switchFailed"));
          return;
        }
        // Success: reload so the boundary marker + carried context show up.
        await refreshPaneMessages(sid);
      })
      .catch(() => {
        setPaneHarness(paneId, previousId, pane?.harnessFollowsPreference);
        setSwitchError(t("harness.switchFailed"));
      })
      .finally(() => {
        setSwitching(false);
        window.setTimeout(() => setSwitchError(null), 6000);
      });
  };

  const currentEntry =
    catalog?.find((h) => h.harness_id === currentHarnessId) ?? null;
  const currentLabel = currentEntry
    ? (currentEntry.builtin ? t("harness.builtin") : currentEntry.display_name)
    : currentHarnessId === BUILTIN_HARNESS_ID
      ? t("harness.builtin")
      : currentHarnessId;

  return (
    <div className="relative min-w-0 max-w-full" ref={anchorRef}>
      <button
        type="button"
        disabled={triggerLocked}
        className={`group flex h-8 min-h-8 max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium leading-5 transition-colors focus:outline-none focus-visible:bg-surface-hover ${
          triggerLocked
            ? "cursor-not-allowed opacity-50"
            : open
              ? "bg-surface-hover"
              : "hover:bg-surface-hover"
        }`}
        onClick={() => {
          if (triggerLocked) return;
          setOpen((v) => !v);
        }}
        title={
          switching
            ? t("harness.switching")
            : disabled
              ? t("harness.switchBusy")
              : t("harness.tooltip")
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={currentLabel}
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
      {switchError ? (
        <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 max-w-[260px] truncate rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-400">
          {switchError}
        </div>
      ) : null}
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
                  const optionLocked = !entry.available || switching;
                  return (
                    <button
                      key={entry.harness_id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      disabled={optionLocked}
                      title={
                        optionLocked
                          ? t("harness.unavailable")
                          : entry.description || entry.display_name
                      }
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] leading-5 transition-colors ${
                        isActive
                          ? "bg-surface-cardStrong"
                          : optionLocked
                            ? "cursor-not-allowed opacity-45"
                            : "hover:bg-surface-hover"
                      }`}
                      onClick={() => {
                        if (optionLocked) return;
                        handleSelect(entry);
                      }}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          optionLocked ? "bg-zinc-600" : "bg-emerald-500"
                        }`}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={`truncate ${isActive ? "font-semibold text-text-strong" : "text-text-standard"}`}
                        >
                          {entry.builtin ? t("harness.builtin") : entry.display_name}
                        </span>
                        {optionLocked && !entry.available ? (
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
