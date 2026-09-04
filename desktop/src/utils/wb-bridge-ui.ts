/** UI helpers for wb_bridge_* tool progress in Desktop chat. */

export function wbBridgeSendToolProgressLabel(sec: number | null | undefined): string {
  return Number.isFinite(sec)
    ? `⏳ wb_bridge_send 执行中…（已等待 ${sec}s；超时后请用 wb_bridge_describe 查询，勿重复投递）`
    : `⏳ wb_bridge_send 执行中…（无头模式：请确认右侧「wb-bridge」终端内 serve 已启动）`;
}

function usageLine(parsed: Record<string, unknown>): string {
  const turns = parsed.turns_completed;
  const usage = parsed.usage_totals;
  if (!usage || typeof usage !== "object") {
    return "";
  }
  const input = (usage as Record<string, unknown>).input_tokens;
  const output = (usage as Record<string, unknown>).output_tokens;
  if (typeof input !== "number" && typeof output !== "number") {
    return "";
  }
  const turnsLabel = typeof turns === "number" ? `${turns}` : "?";
  const inLabel = typeof input === "number" ? `${input}` : "0";
  const outLabel = typeof output === "number" ? `${output}` : "0";
  return `\n\n· 累计 ${turnsLabel} 轮 · in ${inLabel} / out ${outLabel} tokens`;
}

function observedToolsLine(parsed: Record<string, unknown>, status: string): string {
  const tools = parsed.observed_tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return "";
  }
  if (status !== "blocked" && status !== "error") {
    return "";
  }
  return `\n\n本轮已执行：${tools.map(String).join(" → ")}（产物可能已落盘，重试前请先核验）`;
}

export function formatWbBridgeSendToolResult(resultText: string): string | null {
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>;
    const ok = Boolean(parsed.ok);
    const statusRaw = parsed.status;
    const status =
      typeof statusRaw === "string" && statusRaw
        ? statusRaw
        : ok
          ? "success"
          : "";
    const resultTextBody = String(parsed.result_text ?? "").trim();
    const terminalDetail = String(parsed.terminal_detail ?? "").trim();
    const lastActivity = String(parsed.last_activity ?? "").trim();
    const turnSeq = parsed.turn_seq;
    const stalled = Boolean(parsed.stalled);
    const deduplicated = Boolean(parsed.deduplicated);

    let body = "";
    if (status === "success" && resultTextBody) {
      body = `✅ CodeBuddy（WB bridge）\n\n${resultTextBody}${usageLine(parsed)}`;
    } else if (status === "running") {
      const seqPart = typeof turnSeq === "number" ? `第 ${turnSeq} 轮` : "本轮";
      const actPart = lastActivity ? `，当前动作：${lastActivity}` : "";
      const stallPart = stalled ? "（长时间无新输出，疑似等待确认）" : "";
      body = `⏳ WB bridge：本轮仍在执行（${seqPart}${actPart}）。请用 wb_bridge_describe 查询进度，勿重复投递。${stallPart}`;
    } else if (status === "blocked") {
      const detail = terminalDetail ? `（${terminalDetail}）` : "";
      body = `⚠️ WB bridge：被 CodeBuddy 权限确认挡住${detail}。该会话无批准通道，请用 acceptEdits / dontAsk 重开会话。`;
    } else if (status === "error") {
      const detail = terminalDetail ? `（${terminalDetail}）` : "";
      body = `❌ WB bridge：本轮以错误结束${detail}。`;
    } else if (status === "exited") {
      body = `❌ WB bridge：CodeBuddy 进程已退出，需重开会话。`;
    }

    if (body) {
      body += observedToolsLine(parsed, status);
      return deduplicated ? `（重复投递已去重）${body}` : body;
    }

    const tail = String(parsed.tail ?? "").slice(0, 900);
    if (tail) {
      const prefix = deduplicated ? "（重复投递已去重）" : "";
      return `${prefix}⏳ WB bridge：${ok ? "本轮已结束" : "未完成或超时"}。\n${tail}`;
    }
  } catch {
    // fall through
  }
  return null;
}
