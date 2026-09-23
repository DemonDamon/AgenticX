/**
 * Composer slash-command text helpers.
 */

export const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function buildCommandSendText(instructions: string, extra: string): string {
  const body = instructions.trim();
  const note = extra.trim();
  if (!note) return body;
  return `${body}\n\n${note}`;
}

export function splitCommandBody(content: string): { instructions: string; extra: string } {
  const index = content.indexOf("\n\n");
  if (index < 0) return { instructions: content, extra: "" };
  return { instructions: content.slice(0, index), extra: content.slice(index + 2) };
}

export function composeRoomCommandSend(
  command: { kind: string; instructions: string } | null,
  draft: string,
): string {
  const extra = draft.trim();
  if (!command || command.kind !== "prompt") return extra;
  return buildCommandSendText(command.instructions, extra);
}

export function filterCommands<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const prefix = items.filter((item) => item.name.startsWith(q));
  const contains = items.filter((item) => !item.name.startsWith(q) && item.name.includes(q));
  return [...prefix, ...contains];
}

export function parsePerfCommandInput(
  text: string,
  fallbackSessionId: string,
): { sessionId: string; note: string } | null {
  const raw = text.trim();
  const fallback = fallbackSessionId.trim();
  if (!raw) return fallback ? { sessionId: fallback, note: "" } : null;
  if (SESSION_ID_RE.test(raw)) return { sessionId: raw, note: "" };
  const [first, ...rest] = raw.split(/\s+/);
  if (first && SESSION_ID_RE.test(first) && rest.length > 0) {
    return { sessionId: first, note: rest.join(" ") };
  }
  if (fallback) return { sessionId: fallback, note: raw };
  return null;
}

function formatPerfMs(value: number | null): string {
  if (value == null) return "缺失";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

function isVaguePerfNote(note: string): boolean {
  const compact = note.replace(/\s+/g, "");
  if (!compact) return true;
  return /^(请)?(帮我)?(看看|看下|看一下|查看|查一下|诊断一下|诊断)(一下)?(这次|这个|当前)?(对话|会话)?的?(性能|耗时)(数据|情况)?$/.test(compact);
}

export function buildPerfDiagnosisText(
  summary: {
    session_id: string;
    runs: Array<{ status: string; wall_ms: number | null; ttft_ms: number | null }>;
    latest: {
      model: string;
      status: string;
      wall_ms: number | null;
      ttft_ms: number | null;
      model_waits: Array<{ wait_ms: number; until: string }>;
      model_wait_total_ms?: number;
      tool_elapsed_ms: number;
      slowest_tool: { name: string; elapsed_ms: number } | null;
      output_tokens?: number | null;
      turn_output_tokens?: number | null;
      output_tokens_per_sec?: number | null;
    } | null;
  },
  note: string,
): string {
  const latest = summary.latest;
  if (!latest) return "";
  const waits = latest.model_waits.length
    ? latest.model_waits.map((row) => `${row.until} ${formatPerfMs(row.wait_ms)}`).join("，")
    : "缺失";
  const slowest = latest.slowest_tool
    ? `${latest.slowest_tool.name} ${formatPerfMs(latest.slowest_tool.elapsed_ms)}`
    : "缺失";
  const recent = summary.runs
    .slice(0, 5)
    .map((run) => `${run.status} 墙钟 ${formatPerfMs(run.wall_ms)} 首 token ${formatPerfMs(run.ttft_ms)}`)
    .join("\n");
  const counted = latest.turn_output_tokens ?? latest.output_tokens ?? null;
  const rate = latest.output_tokens_per_sec;
  const tokens = counted == null || rate == null
    ? "输出 token 缺失。禁止估算 tokens/s。"
    : `输出 token ${counted}（最后一条回复 ${latest.output_tokens ?? "缺失"}），模型等待合计 ${formatPerfMs(latest.model_wait_total_ms ?? null)}，输出速率 ${rate} tokens/s。这个速率已经用输出 token 除以模型等待合计算好，禁止改用墙钟，禁止自己假设 token 数。`;
  const ask = isVaguePerfNote(note)
    ? "用户没有提出具体问题，只需要看性能。请直接说明时间主要耗在模型等待、首 token 还是工具，这次相对最近几次偏慢还是正常，以及上面给出的输出速率。"
    : `用户的问题：${note.trim()}\n结合这个问题，只用这些数据诊断。`;
  return [
    "请根据下面已经算好的数字做诊断。不要调用任何工具，包括 get_trace、get_session_review 和 mcp_call。get_session_review 只返回健康分，没有 token 数。",
    ask,
    tokens,
    `会话 ${summary.session_id}`,
    `模型 ${latest.model || "缺失"}`,
    `状态 ${latest.status || "缺失"}`,
    `墙钟 ${formatPerfMs(latest.wall_ms)}`,
    `首 token ${formatPerfMs(latest.ttft_ms)}`,
    `最长模型等待 ${waits}`,
    `工具合计 ${formatPerfMs(latest.tool_elapsed_ms)}`,
    `最慢工具 ${slowest}`,
    recent ? `最近运行（只供比较，不要逐条复述）：\n${recent}` : "",
  ].filter(Boolean).join("\n");
}
