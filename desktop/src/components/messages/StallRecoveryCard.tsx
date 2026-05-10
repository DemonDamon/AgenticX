import { AlertTriangle, Info } from "lucide-react";

type Props = {
  kind: "stall" | "exhausted";
  rounds?: number;
  maxRounds?: number;
  onResume: () => void;
  onStop: () => void;
  onOpenSettings?: () => void;
};

const borderAccent: Record<Props["kind"], string> = {
  stall: "border-amber-500/50",
  exhausted: "border-blue-500/50",
};

export function StallRecoveryCard({
  kind,
  rounds,
  maxRounds,
  onResume,
  onStop,
  onOpenSettings,
}: Props) {
  const isStall = kind === "stall";

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex min-w-0 flex-1 justify-start gap-2">
        <div className="flex min-w-0 flex-1 flex-row gap-2">
          {/* Spacer aligned with ImBubble / ToolCallCard avatar column */}
          <div className="flex h-8 w-8 shrink-0" aria-hidden />
          <div
            className="flex min-w-0 flex-1 flex-col items-start"
            style={{ maxWidth: "min(92%, 960px)" }}
          >
            <div
              className={`w-full min-w-0 overflow-hidden rounded-lg border bg-surface-card text-[15px] leading-relaxed ${borderAccent[kind]}`}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                {isStall ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-text-strong">
                    {isStall
                      ? "该任务可能已中断（长时间无响应）"
                      : `已达到最大工具调用轮数（${rounds ?? "?"}/${maxRounds ?? "?"}）`}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onResume}
                      className="rounded-md bg-cyan-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-cyan-500"
                    >
                      {isStall ? "恢复执行" : "继续执行"}
                    </button>

                    {isStall ? (
                      <button
                        type="button"
                        onClick={onStop}
                        className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-rose-500"
                      >
                        中断任务
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenSettings?.()}
                        className="px-1 text-xs font-medium text-text-muted transition hover:text-text-strong"
                      >
                        调整上限
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
