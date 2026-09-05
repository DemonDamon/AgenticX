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

function writtenPathsBlock(parsed: Record<string, unknown>): string {
  const list = parsed.written_paths;
  if (!Array.isArray(list) || list.length === 0) {
    return "";
  }
  const paths = list.map((item) => String(item || "").trim()).filter(Boolean);
  if (paths.length === 0) {
    return "";
  }
  const shown = paths.slice(0, 5);
  const extra = paths.length > 5 ? `\n…共 ${paths.length} 个` : "";
  return `\n\n产物：\n${shown.map((path) => `\`${path}\``).join("\n")}${extra}`;
}

function observedToolsLine(parsed: Record<string, unknown>, status: string): string {
  const tools = parsed.observed_tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return "";
  }
  const chain = tools.map(String).join(" → ");
  if (status === "blocked" || status === "error") {
    return `\n\n本轮已执行：${chain}（产物可能已落盘，重试前请先核验）`;
  }
  if (status === "success" || status === "running") {
    return `\n\n本轮已执行：${chain}`;
  }
  return "";
}

export function formatWbBridgeLiveSnapshot(snap: Record<string, unknown>): string {
  const turnState = String(snap.turn_state ?? "");
  const activity = String(snap.last_activity ?? "").trim();
  const elapsed = snap.turn_elapsed_sec;
  const tools = Array.isArray(snap.observed_tools) ? snap.observed_tools.map(String) : [];
  const stalledAge = snap.last_activity_age_sec;
  const paths = Array.isArray(snap.written_paths) ? snap.written_paths.map(String) : [];
  const parts = [`⏳ WB：${turnState || "running"}`];
  if (typeof elapsed === "number") parts.push(`已 ${elapsed}s`);
  if (activity) parts.push(`当前 ${activity}`);
  if (tools.length) parts.push(`已执行 ${tools.join(" → ")}`);
  if (typeof stalledAge === "number" && stalledAge >= 30) parts.push("疑似等待确认");
  if (paths.length) parts.push(`写入 ${paths.length} 个文件`);
  return parts.join(" · ");
}

export function formatWbBridgeSendToolResult(resultText: string): string | null {
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>;
    const ok = Boolean(parsed.ok);
    const statusRaw = parsed.status;
    const lastKind = parsed.last_terminal_kind;
    const turnState = String(parsed.turn_state ?? "");
    const status =
      typeof statusRaw === "string" && statusRaw
        ? statusRaw
        : typeof lastKind === "string" && lastKind
          ? lastKind
          : turnState === "running"
            ? "running"
            : ok
              ? "success"
              : "";
    const resultTextBody = String(parsed.result_text ?? parsed.last_result_text ?? "").trim();
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
      body += writtenPathsBlock(parsed);
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
