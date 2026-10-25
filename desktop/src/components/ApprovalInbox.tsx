/** Pending-approval inbox: toolbar button plus a body-level popover. */

import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAppStore, type ManagedApprovalItem } from "../store";

type ParkedApprovalItem = {
  request_id: string;
  session_id: string;
  agent_id: string;
  question: string;
  tool: string;
  risk: string;
  protected_reason: string;
  label: string;
  created_at: number;
  expires_at: number;
  remaining_seconds: number;
};

const POLL_MS = 5000;
const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 420;
const PANEL_GAP = 6;
const PANEL_MARGIN = 8;

function normalizeItem(value: unknown): ParkedApprovalItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ParkedApprovalItem>;
  if (typeof row.request_id !== "string" || !row.request_id) return null;
  if (typeof row.session_id !== "string" || !row.session_id) return null;
  return {
    request_id: row.request_id,
    session_id: row.session_id,
    agent_id: typeof row.agent_id === "string" && row.agent_id ? row.agent_id : "meta",
    question: typeof row.question === "string" ? row.question : "",
    tool: typeof row.tool === "string" ? row.tool : "",
    risk: typeof row.risk === "string" ? row.risk : "",
    protected_reason: typeof row.protected_reason === "string" ? row.protected_reason : "",
    label: typeof row.label === "string" ? row.label : "",
    created_at: typeof row.created_at === "number" ? row.created_at : 0,
    expires_at: typeof row.expires_at === "number" ? row.expires_at : 0,
    remaining_seconds: typeof row.remaining_seconds === "number" ? row.remaining_seconds : 0,
  };
}

const MANAGED_ALREADY_RESOLVED = new Set([
  "resolution_conflict",
  "resolution_not_found",
  "duplicate_resolution",
]);

function managedErrorKey(item: ManagedApprovalItem): string {
  return `ma:${item.sessionId}:${item.toolUseId}`;
}

function badgeText(count: number): string {
  return count >= 10 ? "9+" : String(count);
}

function minutesLeft(remainingSeconds: number, snapshotAt: number, nowMs: number): number {
  const elapsed = Math.max(0, (nowMs - snapshotAt) / 1000);
  const live = remainingSeconds - elapsed;
  return Math.max(1, Math.ceil(live / 60));
}

function inboxPanelStyle(anchor: DOMRect): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = anchor.right - PANEL_WIDTH;
  if (left < PANEL_MARGIN) left = anchor.left;
  if (left + PANEL_WIDTH > viewportWidth - PANEL_MARGIN) {
    left = Math.max(PANEL_MARGIN, viewportWidth - PANEL_MARGIN - PANEL_WIDTH);
  }
  const shared: CSSProperties = {
    position: "fixed",
    left,
    width: PANEL_WIDTH,
    maxHeight: PANEL_MAX_HEIGHT,
    zIndex: 200,
  };
  if (anchor.top > viewportHeight / 2) {
    return { ...shared, bottom: viewportHeight - anchor.top + PANEL_GAP };
  }
  return { ...shared, top: anchor.bottom + PANEL_GAP };
}

export function ApprovalInboxButton() {
  const { t } = useTranslation("sidebar");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const managed = useAppStore((s) => s.managedApprovals) ?? {};
  const removeManagedApproval = useAppStore((s) => s.removeManagedApproval);
  const setManagedApprovals = useAppStore((s) => s.setManagedApprovals);
  const managedItems = Object.values(managed).flat();
  const [items, setItems] = useState<ParkedApprovalItem[]>([]);
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [snapshotAt, setSnapshotAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inflightRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    let cancelled = false;

    const pull = async () => {
      try {
        const resp = await fetch(`${apiBase}/api/approvals/pending`, {
          headers: { "x-agx-desktop-token": apiToken },
        });
        if (!resp.ok) return;
        const body = (await resp.json()) as { ok?: boolean; items?: unknown };
        if (!body?.ok || !Array.isArray(body.items) || cancelled || !mountedRef.current) return;
        const next = body.items
          .map(normalizeItem)
          .filter((item): item is ParkedApprovalItem => item !== null)
          .filter((item) => !inflightRef.current.has(item.request_id));
        const stamp = Date.now();
        setSnapshotAt(stamp);
        setNow(stamp);
        setItems(next);
      } catch {
        // Keep the last successful list when a poll fails.
      }
    };

    void pull();
    const timer = window.setInterval(() => {
      void pull();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiBase, apiToken]);

  useEffect(() => {
    if (!open) return;
    const sync = () => {
      const anchor = buttonRef.current;
      if (!anchor) return;
      setPanelStyle(inboxPanelStyle(anchor.getBoundingClientRect()));
    };
    sync();
    setNow(Date.now());
    const onReflow = () => sync();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      window.clearInterval(tick);
    };
  }, [open]);

  const restoreItem = (item: ParkedApprovalItem) => {
    inflightRef.current.delete(item.request_id);
    setItems((prev) => (prev.some((row) => row.request_id === item.request_id) ? prev : [...prev, item]));
  };

  const decide = async (item: ParkedApprovalItem, approved: boolean) => {
    if (!apiBase) return;
    inflightRef.current.add(item.request_id);
    setItems((prev) => prev.filter((row) => row.request_id !== item.request_id));
    setErrors((prev) => {
      if (!prev[item.request_id]) return prev;
      const next = { ...prev };
      delete next[item.request_id];
      return next;
    });
    try {
      const resp = await fetch(`${apiBase}/api/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": apiToken,
        },
        body: JSON.stringify({
          session_id: item.session_id,
          request_id: item.request_id,
          approved,
          agent_id: item.agent_id,
        }),
      });
      if (!mountedRef.current) return;
      if (!resp.ok) {
        restoreItem(item);
        setErrors((prev) => ({
          ...prev,
          [item.request_id]: `${t("approvals.failed")} HTTP ${resp.status}`,
        }));
        return;
      }
      inflightRef.current.delete(item.request_id);
    } catch {
      if (!mountedRef.current) return;
      restoreItem(item);
      setErrors((prev) => ({ ...prev, [item.request_id]: t("approvals.failed") }));
    }
  };

  const decideManaged = async (item: ManagedApprovalItem, approved: boolean) => {
    const errorKey = managedErrorKey(item);
    removeManagedApproval(item.sessionId, item.toolUseId);
    setErrors((prev) => {
      if (!prev[errorKey]) return prev;
      const next = { ...prev };
      delete next[errorKey];
      return next;
    });
    const restore = (message: string) => {
      const current = useAppStore.getState().managedApprovals[item.sessionId] ?? [];
      const restored = current.some((row) => row.toolUseId === item.toolUseId) ? current : [...current, item];
      setManagedApprovals(item.sessionId, restored);
      setErrors((prev) => ({ ...prev, [errorKey]: message }));
    };
    try {
      const res = await window.agenticxDesktop.maPostEvents(item.sessionId, [{
        type: "user.tool_confirmation",
        tool_use_id: item.toolUseId,
        result: approved ? "allow" : "deny",
      }]);
      if (!mountedRef.current) return;
      if (res.ok) return;
      if (MANAGED_ALREADY_RESOLVED.has(res.code)) return;
      restore(`${t("approvals.failed")} ${res.code}`);
    } catch {
      if (!mountedRef.current) return;
      restore(t("approvals.failed"));
    }
  };

  const title = t("approvals.title");
  const total = items.length + managedItems.length;
  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          className="overflow-y-auto rounded-xl border border-border bg-surface-card p-2 shadow-xl"
          style={panelStyle}
          role="dialog"
          aria-label={title}
        >
          {total === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-text-muted">{t("approvals.empty")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {managedItems.map((item) => {
                const error = errors[managedErrorKey(item)];
                return (
                  <div key={managedErrorKey(item)} className="rounded-lg border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-medium text-text-strong">
                        {t("approvals.sourceManaged", { name: item.agentName })}
                      </span>
                      <span className="shrink-0 text-text-muted">{t("approvals.waiting")}</span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[13px] text-text-strong">
                      {t("approvals.managedQuestion", { tool: item.toolName })}
                    </p>
                    <p className="mt-1 line-clamp-2 font-mono text-[12px] text-text-muted">{item.inputPreview}</p>
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="rounded-md border border-border px-3 py-1 text-[12px] text-text-strong hover:bg-surface-hover"
                        onClick={() => {
                          void decideManaged(item, false);
                        }}
                      >
                        {t("approvals.deny")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1 text-[12px] font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))]"
                        onClick={() => {
                          void decideManaged(item, true);
                        }}
                      >
                        {t("approvals.approve")}
                      </button>
                    </div>
                    {error ? <p className="mt-1.5 text-[12px] text-red-500">{error}</p> : null}
                  </div>
                );
              })}
              {items.map((item) => {
                const source = item.label.startsWith("automation:")
                  ? t("approvals.sourceAutomation")
                  : t("approvals.sourceUnattended");
                const error = errors[item.request_id];
                return (
                  <div key={item.request_id} className="rounded-lg border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-medium text-text-strong">{source}</span>
                      <span className="shrink-0 text-text-muted">
                        {t("approvals.remaining", {
                          minutes: minutesLeft(item.remaining_seconds, snapshotAt, now),
                        })}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[13px] text-text-strong" title={item.question}>
                      {item.question}
                    </p>
                    <p className="mt-1 text-[12px] text-text-muted">{item.protected_reason}</p>
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="rounded-md border border-border px-3 py-1 text-[12px] text-text-strong hover:bg-surface-hover"
                        onClick={() => {
                          void decide(item, false);
                        }}
                      >
                        {t("approvals.deny")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1 text-[12px] font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))]"
                        onClick={() => {
                          void decide(item, true);
                        }}
                      >
                        {t("approvals.approve")}
                      </button>
                    </div>
                    {error ? <p className="mt-1.5 text-[12px] text-red-500">{error}</p> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="agx-topbar-btn agx-topbar-btn--icon-only relative"
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={1.8} />
        {total > 0 ? (
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ui-btn-primary-bg)] px-1 text-[10px] font-semibold leading-none text-[var(--ui-btn-primary-text)]">
            {badgeText(total)}
          </span>
        ) : null}
      </button>
      {panel}
    </>
  );
}
