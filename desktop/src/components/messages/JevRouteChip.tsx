import type { Message } from "../../store";
import { useAppStore } from "../../store";
import { useTypesafeSettings } from "../../hooks/useTypesafeSettings";
import { HoverTip } from "../ds/HoverTip";
import {
  isJevHardFallback,
  jevFallbackCauseZh,
  latestJevDecision,
} from "../../utils/jev-decision";

export function JevRouteChip({
  messages,
  visible,
}: {
  messages: Message[];
  visible: boolean;
}) {
  const openSettings = useAppStore((s) => s.openSettings);
  const settings = useTypesafeSettings();

  if (!visible || !settings.enabled) return null;

  const last = latestJevDecision(messages);
  const ready = settings.group_routing && settings.has_key;
  const hardFallback = last?.source === "fallback" && isJevHardFallback(last.fallback_reason);
  const softFallback = last?.source === "fallback" && !hardFallback;
  const fallback = hardFallback || !ready;
  const ok = !fallback && !softFallback && (last?.source === "jev" || ready);
  let tooltip = "未 @ 时由 Jev 判断谁来回复";
  if (!ready) tooltip = "未启用或未配置密钥";
  else if (last?.source === "jev") {
    tooltip = last.model ? `Jev（${last.model}）` : "未 @ 时由 Jev 判断谁来回复";
  } else if (hardFallback) {
    tooltip = `Jev 未采用（${jevFallbackCauseZh(last.fallback_reason)}）`;
  } else if (softFallback) {
    tooltip = `Jev 改走主模型（${jevFallbackCauseZh(last.fallback_reason)}）`;
  }

  return (
    <HoverTip label={tooltip}>
      <button
        type="button"
        className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-muted transition hover:bg-surface-hover"
        onClick={() => {
          if (!ready) openSettings("automation");
        }}
        aria-label="Jev"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            ok ? "bg-emerald-500" : softFallback ? "bg-amber-400" : "bg-red-500"
          }`}
        />
        <span className="font-medium text-text-strong">Jev</span>
      </button>
    </HoverTip>
  );
}
