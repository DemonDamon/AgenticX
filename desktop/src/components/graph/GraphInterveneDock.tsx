import { useMemo, useState } from "react";
import { Loader2, Pause, Play, Ban } from "lucide-react";
import {
  SELECTION_RULE_PRESETS,
  buildInterveneBody,
  classifyDirectiveText,
  type GraphNodeSnapshot,
  type InterveneRequest,
} from "./graph-types";

type Props = {
  version: number;
  selectedNodes: GraphNodeSnapshot[];
  runStatus: string;
  busy: boolean;
  onIntervene: (body: InterveneRequest) => Promise<void>;
  onPauseRun: () => Promise<void>;
  onResumeRun: () => Promise<void>;
};

export function GraphInterveneDock({
  version,
  selectedNodes,
  runStatus,
  busy,
  onIntervene,
  onPauseRun,
  onResumeRun,
}: Props) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"directive" | "rule">("directive");
  const selectedIds = useMemo(() => selectedNodes.map((n) => n.id), [selectedNodes]);
  const taskOrAgentIds = useMemo(() => {
    // Prefer underlying task ids when agent projection node selected
    const ids: string[] = [];
    for (const n of selectedNodes) {
      if (Array.isArray(n.task_ids) && n.task_ids.length) {
        ids.push(...n.task_ids.map(String));
      } else {
        ids.push(n.id);
      }
    }
    return Array.from(new Set(ids));
  }, [selectedNodes]);

  const sendDirective = async () => {
    const t = text.trim();
    if (!t || taskOrAgentIds.length === 0) return;
    const op = classifyDirectiveText(t);
    await onIntervene(
      buildInterveneBody(op, version, {
        nodeIds: taskOrAgentIds,
        payload: { text: t },
      }),
    );
    setText("");
  };

  const sendRule = async (ruleText: string) => {
    const t = ruleText.trim();
    if (!t) return;
    await onIntervene(
      buildInterveneBody("selection_rule", version, {
        nodeIds: taskOrAgentIds,
        payload: { text: t, node_ids: taskOrAgentIds },
      }),
    );
    setText("");
  };

  const cancelSelected = async () => {
    if (taskOrAgentIds.length === 0) return;
    await onIntervene(
      buildInterveneBody("cancel_node", version, {
        nodeIds: taskOrAgentIds,
        payload: {},
      }),
    );
  };

  return (
    <div className="shrink-0 border-t border-border bg-surface-card px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-base p-0.5">
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
              mode === "directive"
                ? "bg-[var(--ui-btn-primary-bg)] text-white shadow-sm"
                : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            }`}
            onClick={() => setMode("directive")}
            aria-pressed={mode === "directive"}
          >
            指令
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
              mode === "rule"
                ? "bg-[var(--ui-btn-primary-bg)] text-white shadow-sm"
                : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            }`}
            onClick={() => setMode("rule")}
            aria-pressed={mode === "rule"}
          >
            对选中下规则
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {runStatus === "paused" ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-text-strong hover:bg-surface-hover"
              disabled={busy}
              onClick={() => void onResumeRun()}
              title="恢复整图"
            >
              <Play className="h-3.5 w-3.5" strokeWidth={2} /> 恢复
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-text-strong hover:bg-surface-hover"
              disabled={busy}
              onClick={() => void onPauseRun()}
              title="暂停整图"
            >
              <Pause className="h-3.5 w-3.5" strokeWidth={2} /> 暂停
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-rose-500 hover:bg-surface-hover [html[data-theme=dark]_&]:text-rose-400 [html[data-theme=dim]_&]:text-rose-400"
            disabled={busy || taskOrAgentIds.length === 0}
            onClick={() => void cancelSelected()}
            title="取消选中节点"
          >
            <Ban className="h-3.5 w-3.5" strokeWidth={2} /> 取消
          </button>
        </div>
      </div>

      {selectedIds.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-text-subtle">
          点击节点后可注入指令，或框选后下规则。
        </p>
      ) : mode === "rule" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {SELECTION_RULE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-text-strong hover:bg-surface-hover"
                disabled={busy}
                onClick={() => {
                  setText(p.text);
                  void sendRule(p.text);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-base px-2.5 py-1.5 text-[13px] text-text-strong outline-none placeholder:text-text-subtle focus:border-[var(--ui-btn-primary-bg)]"
              placeholder="自定义规则…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendRule(text);
                }
              }}
            />
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white"
              style={{ background: "var(--ui-btn-primary-bg)" }}
              disabled={busy || !text.trim()}
              onClick={() => void sendRule(text)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "应用"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-base px-2.5 py-1.5 text-[13px] text-text-strong outline-none placeholder:text-text-subtle focus:border-[var(--ui-btn-primary-bg)]"
            placeholder="给该专家加一句指令，或说「xxx 不用做了」"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void sendDirective();
              }
            }}
          />
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white"
            style={{ background: "var(--ui-btn-primary-bg)" }}
            disabled={busy || !text.trim() || taskOrAgentIds.length === 0}
            onClick={() => void sendDirective()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "发送"}
          </button>
        </div>
      )}
    </div>
  );
}
