import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getBrowserAgentInFlight,
  isBrowserHumanTakeover,
  setBrowserHumanTakeover,
  subscribeBrowserAgentActivity,
  subscribeBrowserHumanTakeover,
} from "./browser-agent-registry";

const ACTIVITY_HOLD_MS = 3000;

export function BrowserAgentOverlay({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation("workspace");
  const sid = sessionId.trim();
  const [takenOver, setTakenOver] = useState(() => isBrowserHumanTakeover(sid));
  const [busy, setBusy] = useState(() => getBrowserAgentInFlight(sid) > 0);
  const [lastActAt, setLastActAt] = useState(0);

  useEffect(() => {
    return subscribeBrowserHumanTakeover(sid, setTakenOver);
  }, [sid]);

  useEffect(() => {
    return subscribeBrowserAgentActivity(sid, () => {
      setBusy(getBrowserAgentInFlight(sid) > 0);
      setLastActAt(Date.now());
    });
  }, [sid]);

  useEffect(() => {
    if (!lastActAt || busy) return;
    const timer = window.setTimeout(() => {
      setLastActAt((prev) => (Date.now() - prev >= ACTIVITY_HOLD_MS ? 0 : prev));
    }, ACTIVITY_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [lastActAt, busy]);

  const recentlyActive = lastActAt > 0 && Date.now() - lastActAt < ACTIVITY_HOLD_MS;
  if (!takenOver && !busy && !recentlyActive) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface-card-strong px-3 py-1.5 shadow-sm">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            takenOver ? "bg-status-warning" : "bg-status-success"
          }`}
          aria-hidden
        />
        <span className="text-[12px] text-text-strong">
          {takenOver ? t("work.browserTakenOver") : t("work.browserAgentOperating")}
        </span>
        {takenOver ? (
          <button
            type="button"
            className="rounded-full border border-border bg-surface-hover px-2.5 py-0.5 text-[12px] text-text-strong"
            onClick={() => setBrowserHumanTakeover(sid, false)}
          >
            {t("work.browserReturnToAgent")}
          </button>
        ) : (
          <button
            type="button"
            className="rounded-full bg-[var(--ui-btn-primary-bg)] px-2.5 py-0.5 text-[12px] text-[var(--ui-btn-primary-fg,#fff)]"
            onClick={() => setBrowserHumanTakeover(sid, true)}
          >
            {t("work.browserTakeover")}
          </button>
        )}
      </div>
    </div>
  );
}
