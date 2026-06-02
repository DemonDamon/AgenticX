import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCw, Wrench } from "lucide-react";

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
  "creating-venv": "创建虚拟环境…",
  "upgrading-pip": "升级 pip…",
  installing: "安装知识库与文档解析依赖（可能耗时数分钟）…",
  done: "修复完成",
  error: "修复失败",
};

/**
 * Diagnoses backend Python deps (chromadb, onnxruntime, numpy, PDF libs) and
 * offers a one-click repair that installs agenticx[desktop-runtime] into
 * ~/.agenticx/.venv. Only renders a banner when there is a problem.
 */
export function BackendDepsPanel() {
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
              后端依赖已修复，请完全退出并重启 Near 使其生效。
            </p>
          ) : (
            <>
              <p className="text-xs font-medium text-amber-200">
                知识库/文档解析所需的后端依赖缺失
                {missing.length > 0 ? `：${missing.join("、")}` : ""}
              </p>
              {diag?.pythonPath ? (
                <p className="mt-0.5 break-all text-[11px] text-text-subtle">
                  当前后端 Python：{diag.pythonPath}
                </p>
              ) : null}
              {diag?.usingBundled ? (
                <p className="mt-0.5 text-[11px] text-text-subtle">
                  检测到内嵌后端但依赖检查失败，通常表示安装包损坏，建议重新安装应用。
                </p>
              ) : (
                <p className="mt-0.5 text-[11px] text-text-subtle">
                  点击修复将创建 ~/.agenticx/.venv 并安装 agenticx[desktop-runtime]（含 chromadb、PDF 解析、SOCKS 代理 socksio 等）。
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
            {repairing ? "修复中…" : needsRestart ? "立即重启" : "一键修复"}
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
