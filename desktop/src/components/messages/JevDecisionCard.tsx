import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Message } from "../../store";
import {
  jevActionLabelZh,
  jevConfidencePct,
  jevFallbackCauseZh,
  jevGateLabelZh,
  jevKbActionLabel,
  jevPayloadFromMessage,
  jevTargetLabel,
  type JevDecisionPayload,
} from "../../utils/jev-decision";
import { GROUP_INLINE_CARD_SHELL_CLASS } from "./im-layout";

function JevMark({ pending = false }: { pending?: boolean }) {
  return (
    <div
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-card-strong text-[11px] font-semibold text-text-strong"
      aria-hidden
    >
      J
      {pending ? (
        <span className="sr-only">pending</span>
      ) : null}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      <span className="h-1 w-1 rounded-full bg-text-faint agx-dot-pulse" />
      <span className="h-1 w-1 rounded-full bg-text-faint agx-dot-pulse" style={{ animationDelay: "0.2s" }} />
      <span className="h-1 w-1 rounded-full bg-text-faint agx-dot-pulse" style={{ animationDelay: "0.4s" }} />
    </span>
  );
}

function GateBadge({ gate }: { gate: string }) {
  if (gate !== "auto" && gate !== "review") return null;
  const ok = gate === "auto";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] text-text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-400"}`} />
      {jevGateLabelZh(gate)}
    </span>
  );
}

function actionLine(payload: JevDecisionPayload): string {
  if (payload.purpose === "kb_auto") return jevKbActionLabel(payload);
  return `${jevActionLabelZh(payload.action, payload.purpose)} · ${jevTargetLabel(payload)}`;
}

export function JevDecisionCard({
  message,
  groupChatRail = false,
}: {
  message: Message;
  groupChatRail?: boolean;
}) {
  const payload = jevPayloadFromMessage(message);
  const [openProbs, setOpenProbs] = useState(false);
  if (!payload) return null;
  const model = payload.model || payload.requested_model;
  const pct = jevConfidencePct(payload.confidence);
  const shell = groupChatRail ? GROUP_INLINE_CARD_SHELL_CLASS : "my-2 min-w-0 w-full max-w-[520px]";
  const pending = payload.phase === "pending";
  const fallback = !pending && payload.source !== "jev";
  const entries = Object.entries(payload.probabilities);

  return (
    <div className={`${shell} px-1`} data-slot="jev-decision-card">
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
          <JevMark pending={pending} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[13px] font-semibold text-text-strong">Jev</span>
            {model ? (
              <span className="font-mono text-[10px] text-text-faint">{model}</span>
            ) : null}
            {!pending && !fallback ? <GateBadge gate={payload.gate} /> : null}
          </div>
          {pending ? (
            <div className="mt-0.5 flex items-center gap-2 text-[12px] text-text-muted">
              <ThinkingDots />
              <span>
                {payload.purpose === "kb_auto" ? "Jev 正在判断是否检索" : "Jev 正在判断谁来回复"}
              </span>
            </div>
          ) : fallback ? (
            <div className="mt-0.5 text-[12px] text-red-400">
              未采用 · {jevFallbackCauseZh(payload.fallback_reason)}
            </div>
          ) : (
            <>
              <div className="mt-0.5 text-[12px] text-text-standard">{actionLine(payload)}</div>
              {pct != null ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[11px] text-text-muted">置信度 {pct}%</span>
                  <div className="h-0.5 min-w-[64px] flex-1 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full bg-text-strong"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ) : null}
              {entries.length > 0 ? (
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-text-faint"
                  onClick={() => setOpenProbs((v) => !v)}
                >
                  {openProbs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  概率
                </button>
              ) : null}
              {openProbs ? (
                <ul className="mt-0.5 space-y-0.5 text-[11px] text-text-muted">
                  {entries.map(([key, value]) => (
                    <li key={key} className="flex justify-between gap-3">
                      <span>{jevActionLabelZh(key, payload.purpose)}</span>
                      <span className="font-mono tabular-nums">{value.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
