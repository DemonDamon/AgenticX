import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, RotateCw, Wrench } from "lucide-react";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


type Diag = {
  ok: boolean;
  usingBundled?: boolean;
  pythonPath?: string;
  missing?: string[];
  detail?: string;
  error?: string;
};

type RepairPhase =
  | "idle"
  | "creating-venv"
  | "upgrading-pip"
  | "installing"
  | "done"
  | "error";

const PHASE_LABEL: Record<RepairPhase, string> = {
  idle: "",
  "creating-venv": st("knowledge.repairCreatingVenv"),
  "upgrading-pip": st("knowledge.repairUpgradingPip"),
  installing: st("knowledge.repairInstalling"),
  done: st("knowledge.repairDone"),
  error: st("knowledge.repairError"),
};

/**
 * Diagnoses backend Python deps (chromadb, onnxruntime, numpy, PDF libs) and
 * offers a one-click repair that installs agenticx[desktop-runtime] into
 * ~/.agenticx/.venv. Only renders a banner when there is a problem.
 */
export function BackendDepsPanel() {
  const { t } = useTranslation("settings");
  const [diag, setDiag] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [phase, setPhase] = useState<RepairPhase>("idle");
  const [pct, setPct] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  const runDiagnose = useCallback(async () => {
    setBusy(true);
    try {
      const r = await window.agenticxDesktop.diagnoseBackendDeps();
      setDiag(r);
    } catch (err) {
      setDiag({
        ok: false,
        error: String(err),
        missing: ["chromadb", "pdf (PyMuPDF or pypdf)"],
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void runDiagnose();
  }, [runDiagnose]);

  useEffect(() => {
    const off = window.agenticxDesktop.onBackendDepsProgress((p) => {
      setPhase((p.phase as RepairPhase) || "idle");
      if (typeof p.pct === "number") setPct(p.pct);
      if (p.line) {
        setLines((prev) => [...prev.slice(-200), p.line as string]);
        requestAnimationFrame(() => {
          if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        });
      }
    });
    return off;
  }, []);

  const handleRepair = useCallback(async () => {
    setRepairing(true);
    setLines([]);
    setPct(0);
    setPhase("creating-venv");
    try {
      const r = await window.agenticxDesktop.repairBackendDeps();
      if (r.ok) {
        setPhase("done");
        setPct(100);
        await runDiagnose();
      } else {
        setPhase("error");
      }
    } catch {
      setPhase("error");
    } finally {
      setRepairing(false);
    }
  }, [runDiagnose]);

  const handleRelaunch = useCallback(async () => {
    await window.agenticxDesktop.appRelaunch();
  }, []);

  const missing = diag?.missing ?? [];
  const needsRestart = phase === "done";
  const hasProblem = !!diag && (missing.length > 0 || diag.ok === false);

  // Healthy and not mid-repair: stay out of the way.
  if (!hasProblem && phase !== "done" && !repairing) {
    return null;
  }

  return (
    <div className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
      <div className="flex items-start gap-2">
        {phase === "done" ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          {phase === "done" ? (
            <p className="text-xs font-medium text-emerald-300">
              {st("knowledge.repairRestart")}
            </p>
          ) : (
            <>
              <p className="text-xs font-medium text-amber-200">
                {st("knowledge.depsMissing")}
                {missing.length > 0 ? `：${missing.join("、")}` : ""}
              </p>
              {diag?.pythonPath ? (
                <p className="mt-0.5 break-all text-[11px] text-text-subtle">
                  {st("knowledge.pythonPath", { path: diag.pythonPath })}
                </p>
              ) : null}
              {diag?.usingBundled ? (
                <p className="mt-0.5 text-[11px] text-text-subtle">
                  {st("knowledge.embeddedBroken")}
                </p>
              ) : (
                <p className="mt-0.5 text-[11px] text-text-subtle">
                  {st("knowledge.repairHint")}
                </p>
              )}
            </>
          )}
        </div>
        {!diag?.usingBundled ? (
          <button
            type="button"
            disabled={repairing || (busy && !needsRestart)}
            onClick={() => void (needsRestart ? handleRelaunch() : handleRepair())}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
              needsRestart
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "bg-btnPrimary text-btnPrimary-text hover:bg-btnPrimary-hover"
            }`}
          >
            {repairing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : needsRestart ? (
              <RotateCw className="h-3.5 w-3.5" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
            {repairing ? st("knowledge.repairing") : needsRestart ? st("knowledge.restartNow") : st("knowledge.oneClickRepair")}
          </button>
        ) : null}
      </div>

      {(repairing || (phase !== "idle" && lines.length > 0)) ? (
        <div className="mt-2">
          {repairing ? (
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-text-subtle">
              <span>{PHASE_LABEL[phase]}</span>
              <span>{pct}%</span>
            </div>
          ) : null}
          <div className="h-1 w-full overflow-hidden rounded bg-black/20">
            <div
              className="h-full bg-emerald-400 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          {lines.length > 0 ? (
            <div
              ref={logRef}
              className="mt-2 max-h-28 overflow-y-auto rounded bg-black/30 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-text-muted"
            >
              {lines.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {l}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
