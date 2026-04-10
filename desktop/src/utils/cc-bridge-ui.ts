/**
 * CC Bridge UI copy: must follow actual session mode (headless vs visible_tui),
 * not only global Settings "运行模式" (which can stay on Visible TUI while a headless session runs).
 */

export type CcBridgeSessionModeHint = "headless" | "visible_tui" | "";

/** Parse mode from cc_bridge_start tool args or result JSON. */
export function parseCcBridgeModeFromPayload(payload: unknown): CcBridgeSessionModeHint {
  if (!payload || typeof payload !== "object") return "";
  const o = payload as Record<string, unknown>;
  const m = String(o.mode ?? "").trim().toLowerCase();
  if (m === "headless" || m === "visible_tui") return m;
  return "";
}

export function ccBridgeSendToolProgressLabel(
  elapsedSeconds: number,
  lastResolvedMode: CcBridgeSessionModeHint
): string {
  const sec = Number(elapsedSeconds);
  const hasSec = Number.isFinite(sec) && sec >= 0;
  const headlessLine = hasSec
    ? `⏳ cc_bridge_send 执行中…（已等待 ${sec}s；无头模式：等待 Claude Code 流式结果，无需在右侧「claude-code」终端内按键）`
    : `⏳ cc_bridge_send 执行中…（无头模式：等待桥接返回，无需打开右侧交互终端）`;
  const visibleLine = hasSec
    ? `⏳ cc_bridge_send 执行中…（已等待 ${sec}s；可见模式：请先单击右侧工作区「claude-code」终端内部，再按键盘选允许/拒绝——焦点若在聊天输入框，按键进不了终端）`
    : `⏳ cc_bridge_send 执行中…（可见模式：先单击右侧「claude-code」终端再按键操作）`;
  const neutralLine = hasSec
    ? `⏳ cc_bridge_send 执行中…（已等待 ${sec}s）`
    : `⏳ cc_bridge_send 执行中…`;

  if (lastResolvedMode === "headless") return headlessLine;
  if (lastResolvedMode === "visible_tui") return visibleLine;
  return neutralLine;
}
