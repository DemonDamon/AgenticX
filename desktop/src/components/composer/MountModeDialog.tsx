import { Check } from "lucide-react";
import { createPortal } from "react-dom";
import type { TaskspaceMountMode } from "../../store";

type Props = {
  sources: string[];
  mode: TaskspaceMountMode;
  adding: boolean;
  onModeChange: (mode: TaskspaceMountMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

const OPTIONS = [
  {
    id: "reference" as const,
    title: "引用（只读）",
    desc: "agent 只能读取，不会改动你的文件",
  },
  {
    id: "copy" as const,
    title: "工作副本",
    desc: "复制一份到会话隔离目录，改动需你确认后才回写",
  },
  {
    id: "link" as const,
    title: "直连原目录",
    desc: "agent 的改动会直接写入所选路径",
    danger: true,
  },
] as const;

export function MountModeDialog({
  sources,
  mode,
  adding,
  onModeChange,
  onCancel,
  onConfirm,
}: Props) {
  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-base p-4 shadow-2xl">
        <div className="mb-3 text-[15px] font-medium text-text-strong">选择添加方式</div>
        <div className="mb-3 truncate text-[12px] text-text-faint">
          {sources.length === 1 ? sources[0] : `${sources.length} 个路径`}
        </div>
        <div className="space-y-2">
          {OPTIONS.map((opt) => {
            const active = mode === opt.id;
            const danger = "danger" in opt && opt.danger;
            const desc =
              opt.id === "link"
                ? `agent 的改动会直接写入 ${sources[0] || "所选路径"}`
                : opt.desc;
            return (
              <button
                key={opt.id}
                type="button"
                className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
                  active
                    ? danger
                      ? "border-rose-400/50 bg-rose-500/10"
                      : "border-[rgba(var(--theme-color-rgb),0.55)] bg-[rgba(var(--theme-color-rgb),0.12)]"
                    : "border-border bg-surface-hover hover:bg-surface-card-strong"
                }`}
                onClick={() => onModeChange(opt.id)}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    active ? "bg-emerald-500 text-white" : "border border-border bg-transparent"
                  }`}
                  aria-hidden
                >
                  {active ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[13px] font-medium ${
                      danger ? "text-rose-300" : "text-text-primary"
                    }`}
                  >
                    {opt.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-text-faint">
                    {desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[13px] text-text-muted hover:bg-surface-hover"
            onClick={onCancel}
            disabled={adding}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[13px] hover:opacity-90 disabled:opacity-50"
            style={{
              background: "var(--ui-btn-primary-bg)",
              color: "var(--ui-btn-primary-text)",
            }}
            onClick={onConfirm}
            disabled={adding}
          >
            {adding ? "添加中…" : "确认添加"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
