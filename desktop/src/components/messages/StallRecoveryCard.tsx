import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import { STALL_MODEL_FALLBACKS } from "../../utils/task-stall-policy";

export type StallModelOption = {
  provider: string;
  model: string;
  label: string;
};

type Props = {
  kind: "stall" | "exhausted";
  /** For kind="stall": "silent" = a running turn went quiet (may be hung);
   *  "incomplete" = the turn ended without a visible reply (think-only /
   *  degenerate / cut) — phrased as "未产出回答", never "长时间无响应". */
  reason?: "silent" | "incomplete";
  rounds?: number;
  maxRounds?: number;
  currentModelLabel?: string;
  modelOptions?: StallModelOption[];
  autoNudgeCount?: number;
  autoNudgeMax?: number;
  onResume: () => void;
  onResumeWithModel: (provider: string, model: string) => void;
  onStop: () => void;
  stopInFlight?: boolean;
  resumeInFlight?: boolean;
  rejectReason?: string;
  onOpenSettings?: () => void;
  /** When false, hide resume / model-switch / stop actions (bodyless tool turns). */
  allowResume?: boolean;
};

const borderAccent: Record<Props["kind"], string> = {
  stall: "border-amber-500/50",
  exhausted: "border-blue-500/50",
};

export function StallRecoveryCard({
  kind,
  reason = "silent",
  rounds,
  maxRounds,
  currentModelLabel,
  modelOptions,
  autoNudgeCount = 0,
  autoNudgeMax = 0,
  onResume,
  onResumeWithModel,
  onStop,
  stopInFlight = false,
  resumeInFlight = false,
  rejectReason = "",
  onOpenSettings,
  allowResume = true,
}: Props) {
  const { t } = useTranslation("chat");
  const isStall = kind === "stall";
  const isIncomplete = isStall && reason === "incomplete";
  const [switchOpen, setSwitchOpen] = useState(false);
  const [picked, setPicked] = useState("");

  const options = useMemo(() => {
    const base = modelOptions && modelOptions.length > 0 ? modelOptions : STALL_MODEL_FALLBACKS;
    const seen = new Set<string>();
    return base.filter((o) => {
      const key = `${o.provider}::${o.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [modelOptions]);

  const confirmSwitch = () => {
    if (resumeInFlight) return;
    const key = picked || (options[0] ? `${options[0].provider}::${options[0].model}` : "");
    const row = options.find((o) => `${o.provider}::${o.model}` === key) ?? options[0];
    if (!row) return;
    onResumeWithModel(row.provider, row.model);
    setSwitchOpen(false);
  };

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex min-w-0 flex-1 justify-start gap-2">
        <div className="flex min-w-0 flex-1 flex-row gap-2">
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <div
                className={`w-full min-w-0 overflow-hidden rounded-lg border bg-surface-card text-[15px] leading-relaxed ${
                  isStall ? borderAccent.stall : borderAccent.exhausted
                }`}
              >
                <div className="flex items-start gap-3 px-4 py-3">
                  {isStall ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium text-text-strong">
                      {!allowResume && isIncomplete
                        ? t("stall.incompleteNoResume")
                        : isStall
                          ? isIncomplete
                            ? t("stall.noAnswer")
                            : t("stall.maybeStuck")
                          : t("stall.maxRounds", { rounds: rounds ?? "?", max: maxRounds ?? "?" })}
                    </p>
                    {!allowResume && isIncomplete ? (
                      <p className="mt-1 text-xs text-text-muted">
                        {t("stall.keepTools")}
                      </p>
                    ) : isStall && currentModelLabel ? (
                      <p className="mt-1 text-xs text-text-muted">
                        {isIncomplete
                          ? t("stall.currentModelRetry", { model: currentModelLabel })
                          : t("stall.currentModelSwitch", { model: currentModelLabel })}
                      </p>
                    ) : null}
                    {allowResume && isStall && autoNudgeMax > 0 && autoNudgeCount >= autoNudgeMax ? (
                      <p className="mt-1 text-xs text-amber-300/90">
                        {t("stall.autoNudgeCap", { count: autoNudgeCount })}
                      </p>
                    ) : null}

                    {allowResume ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onResume}
                        disabled={resumeInFlight}
                        className="rounded-md bg-btnPrimary px-3 py-1 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {resumeInFlight
                          ? (isStall ? t("stall.resuming") : t("stall.continuing"))
                          : isStall
                            ? t("stall.resume")
                            : t("stall.continue")}
                      </button>

                      {isStall ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setSwitchOpen((v) => !v)}
                            disabled={resumeInFlight}
                            className="rounded-md border border-border bg-surface-hover px-3 py-1 text-xs font-medium text-text-strong transition hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t("stall.switchModel")}
                            <ChevronDown
                              className={`ml-1 inline h-3 w-3 transition-transform ${switchOpen ? "rotate-180" : ""}`}
                              aria-hidden
                            />
                          </button>
                          <button
                            type="button"
                            onClick={onStop}
                            disabled={stopInFlight}
                            className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {stopInFlight ? t("stall.stopping") : t("stall.stopTask")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenSettings?.()}
                          className="px-1 text-xs font-medium text-text-muted transition hover:text-text-strong"
                        >
                          {t("stall.adjustLimit")}
                        </button>
                      )}
                    </div>
                    ) : null}

                    {rejectReason ? (
                      <p className="mt-2 text-xs text-rose-400">{t("stall.rejected", { reason: rejectReason })}</p>
                    ) : null}

                    {isStall && switchOpen ? (
                      <SwitchModelPanel
                        options={options}
                        picked={picked}
                        onPick={setPicked}
                        onConfirm={confirmSwitch}
                        onCancel={() => setSwitchOpen(false)}
                        resumeInFlight={resumeInFlight}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SwitchModelPanel({
  options,
  picked,
  onPick,
  onConfirm,
  onCancel,
  resumeInFlight = false,
}: {
  options: StallModelOption[];
  picked: string;
  onPick: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  resumeInFlight?: boolean;
}) {
  const { t } = useTranslation("chat");
  const { t: tCommon } = useTranslation("common");
  return (
    <div className="mt-3 rounded-md border border-border/80 bg-surface-panel/80 p-2">
      <label className="mb-1 block text-[11px] text-text-muted">{t("stall.pickFallback")}</label>
      <select
        className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-strong"
        value={picked || (options[0] ? `${options[0].provider}::${options[0].model}` : "")}
        onChange={(e) => onPick(e.target.value)}
      >
        {options.map((o) => (
          <option key={`${o.provider}::${o.model}`} value={`${o.provider}::${o.model}`}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={resumeInFlight}
          className="rounded-md bg-btnPrimary px-2.5 py-1 text-[11px] font-medium text-btnPrimary-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resumeInFlight ? t("stall.continuing") : t("stall.confirmContinue")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:text-text-strong"
        >
          {tCommon("cancel")}
        </button>
      </div>
    </div>
  );
}
