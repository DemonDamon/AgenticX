import type { Message } from "../store";

/** Matches backend hook-blocked reason strings from legacy_event_bridge_hook and agent_runtime. */
export const HOOK_BLOCK_RE = /工具(?:调用)?被\s*(?:Hook\s*)?策略阻止|Hook.*策略.*阻止/;

export function isHookBlockedToolMessage(
  message: Pick<Message, "content" | "toolStatus">,
): boolean {
  return (
    HOOK_BLOCK_RE.test(String(message.content ?? ""))
    && (message.toolStatus === "error" || message.toolStatus === "done")
  );
}

const TOOL_RETURN_PREFIX_RE = /^#{0,3}\s*工具返回(?:原样|如下)?\s*[:：]?\s*/i;

/** Strip common model wrappers when it only echoes a hook-block tool result. */
export function stripHookBlockEchoWrappers(text: string): string {
  let out = String(text ?? "").trim();
  out = out.replace(TOOL_RETURN_PREFIX_RE, "");
  out = out.replace(/^工具返回(?:原样|如下)?\s*[:：]?\s*/i, "");
  out = out.replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n`]*\n?/i, "").replace(/\n?```$/i, ""));
  out = out.replace(/^TEXT\s*\n?/i, "");
  return out.trim();
}

type HookToolContext = Pick<Message, "toolName" | "toolArgs">;

/** Walk backward within the current assistant turn for the hook-blocked tool row. */
export function findNearbyHookBlockedTool(
  allMessages: Array<Pick<Message, "role" | "content" | "toolStatus" | "toolName" | "toolArgs">>,
  messageIndex: number,
): HookToolContext | null {
  if (messageIndex <= 0) return null;
  for (let i = messageIndex - 1; i >= 0; i -= 1) {
    const row = allMessages[i];
    if (!row) continue;
    if (row.role === "user") break;
    if (row.role === "tool" && isHookBlockedToolMessage(row)) {
      return { toolName: row.toolName, toolArgs: row.toolArgs };
    }
  }
  return null;
}

function truncateInline(text: string, max = 72): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

/** User-facing copy when the model only echoes the hook-block system string. */
export function buildHookBlockFriendlyNotice(toolCtx: HookToolContext | null): string {
  const name = String(toolCtx?.toolName ?? "").trim();
  const args = toolCtx?.toolArgs ?? {};
  if (name === "bash_exec") {
    const cmd = truncateInline(String(args.command ?? ""));
    if (cmd) return `出于安全考虑，没有执行这条命令：${cmd}`;
    return "出于安全考虑，该 shell 命令已被拦截，未实际执行。";
  }
  if (name === "file_write" || name === "file_edit") {
    const path = truncateInline(String(args.path ?? ""), 96);
    if (path) return `出于安全考虑，未修改文件 ${path}。`;
    return "出于安全考虑，该文件写入操作已被拦截。";
  }
  if (name === "file_read") {
    const path = truncateInline(String(args.path ?? ""), 96);
    if (path) return `出于安全考虑，未读取文件 ${path}。`;
    return "出于安全考虑，该文件读取操作已被拦截。";
  }
  if (name === "mcp_call") {
    const toolName = truncateInline(String(args.tool_name ?? ""), 48);
    if (toolName) return `出于安全考虑，未调用 MCP 工具 ${toolName}。`;
    return "出于安全考虑，该 MCP 调用已被拦截。";
  }
  if (name) return `出于安全考虑，${name} 已被拦截，未实际执行。`;
  return "出于安全考虑，该操作已被拦截，未实际执行。";
}

/** Assistant rows that only restate the hook-block system text add no user value. */
export function isHookBlockEchoAssistantMessage(
  message: Pick<Message, "role" | "content">,
): boolean {
  if (message.role !== "assistant") return false;
  const raw = String(message.content ?? "").trim();
  if (!raw) return false;
  const stripped = stripHookBlockEchoWrappers(raw);
  if (!HOOK_BLOCK_RE.test(stripped)) return false;
  const remainder = stripped
    .replace(HOOK_BLOCK_RE, "")
    .replace(/[\s:：\-—·。．,.!！?？]/g, "")
    .trim();
  return remainder.length === 0;
}
