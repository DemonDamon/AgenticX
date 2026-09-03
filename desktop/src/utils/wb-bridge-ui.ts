/** UI helpers for wb_bridge_* tool progress in Desktop chat. */

export function wbBridgeSendToolProgressLabel(sec: number | null | undefined): string {
  return Number.isFinite(sec)
    ? `⏳ wb_bridge_send 执行中…（已等待 ${sec}s；无头模式：等待 CodeBuddy 流式结果，无需在聊天框按键）`
    : `⏳ wb_bridge_send 执行中…（无头模式：请确认右侧「wb-bridge」终端内 serve 已启动）`;
}

export function formatWbBridgeSendToolResult(resultText: string): string | null {
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>;
    const ok = Boolean(parsed.ok);
    const resultTextBody = String(parsed.result_text ?? "").trim();
    if (ok && resultTextBody) {
      return `✅ CodeBuddy（WB bridge）\n\n${resultTextBody}`;
    }
    const tail = String(parsed.tail ?? "").slice(0, 900);
    if (tail) {
      return `⏳ WB bridge：${ok ? "本轮已结束" : "未完成或超时"}。\n${tail}`;
    }
  } catch {
    // fall through
  }
  return null;
}
