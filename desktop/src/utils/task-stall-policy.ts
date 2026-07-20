/**
 * Stall detection thresholds and helpers for long-running Near tasks.
 */

import type { ParsedTodo, TodoItem } from "../components/TodoUpdateCard";
import type { Message } from "../store";
import { parseReasoningContent } from "../components/messages/reasoning-parser";
import { assistantBodyText, looksLikeUnfinishedAssistantBody } from "./budget-incomplete-message";
import { assistantVisibleBodyForUi } from "./assistant-output";

/** Default stall warning threshold (seconds) — overridable via Settings → 工具 → 长任务停滞与续跑. */
export const DEFAULT_STALL_DETECT_SILENCE_SECONDS = 90;

/** Legacy constants; prefer {@link stallDetectSilenceMs} with runtime config. */
export const STALL_SSE_SILENCE_MS = DEFAULT_STALL_DETECT_SILENCE_SECONDS * 1000;
export const STALL_RUNNING_SILENCE_MS = DEFAULT_STALL_DETECT_SILENCE_SECONDS * 1000;

export const STALL_DETECT_SILENCE_MIN_SECONDS = 30;
export const STALL_DETECT_SILENCE_MAX_SECONDS = 300;

export function clampStallDetectSilenceSeconds(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_STALL_DETECT_SILENCE_SECONDS;
  return Math.max(
    STALL_DETECT_SILENCE_MIN_SECONDS,
    Math.min(STALL_DETECT_SILENCE_MAX_SECONDS, Math.round(n)),
  );
}

export function stallDetectSilenceMs(seconds?: number): number {
  return clampStallDetectSilenceSeconds(seconds) * 1000;
}

export const CHANNEL_C_GRACE_MS = 5_000;

const INTERRUPTED_ASSISTANT_PLACEHOLDERS = new Set(["（已中断）", "(已中断)"]);

export type StallPhase = "none" | "stall" | "exhausted";

export type StallAutoNudgeContext = {
  /** Live SSE subscription for the displayed session. */
  sseActive?: boolean;
  /** User stop guard or an in-flight chat request for this session. */
  runInFlight?: boolean;
};

export function messageLooksLikeAssistantFinal(message: Message | undefined): boolean {
  if (!message) return false;
  if (message.role !== "assistant") return false;
  if (message.id === "__stream__") return false;
  const content = assistantBodyText(message);
  if (!content) return false;
  if (looksLikeUnfinishedAssistantBody(content)) return false;
  return true;
}

/**
 * True when the last user turn already has a non-empty assistant reply.
 * Aligns with backend ``SessionManager._messages_last_turn_has_completed_reply``.
 */
export function lastTurnHasCompletedAssistantReply(messages: Message[]): boolean {
  if (!messages.length) return false;
  let lastUserIdx = -1;
  for (let idx = 0; idx < messages.length; idx += 1) {
    if (messages[idx]?.role === "user") lastUserIdx = idx;
  }
  if (lastUserIdx < 0) return false;

  let sawMarker = false;
  let lastReplyIdx = -1;
  for (let idx = lastUserIdx + 1; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    if (msg.id === "__stream__" || msg.id === "typing-meta") continue;
    const meta = msg.metadata;
    if (meta && String(meta.source ?? "").trim() === "interrupted-partial") continue;
    const visible = assistantVisibleBodyForUi(String(msg.content ?? "")).trim();
    const turnTerminal = meta?.turn_terminal;
    if (turnTerminal === true || turnTerminal === false) {
      sawMarker = true;
      if (
        turnTerminal === true &&
        visible &&
        !INTERRUPTED_ASSISTANT_PLACEHOLDERS.has(visible)
      ) {
        lastReplyIdx = idx;
      }
      continue;
    }
  }
  if (sawMarker) {
    if (lastReplyIdx < 0) return false;
  } else {
    for (let idx = lastUserIdx + 1; idx < messages.length; idx += 1) {
      const msg = messages[idx];
      if (msg?.role !== "assistant") continue;
      if (msg.id === "__stream__" || msg.id === "typing-meta") continue;
      const meta = msg.metadata;
      if (meta && String(meta.source ?? "").trim() === "interrupted-partial") continue;
      const content = assistantVisibleBodyForUi(String(msg.content ?? "")).trim();
      if (!content) continue;
      if (INTERRUPTED_ASSISTANT_PLACEHOLDERS.has(content)) continue;
      lastReplyIdx = idx;
    }
    if (lastReplyIdx < 0) return false;
  }

  for (let idx = lastReplyIdx + 1; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    const toolCalls = (msg.tool_calls as unknown[] | undefined) ?? [];
    if (toolCalls.length > 0) return false;
  }
  return true;
}

/** True when the last user turn has tool activity (tool row or tool_calls). */
export function lastTurnHasToolActivity(messages: Message[]): boolean {
  if (!messages.length) return false;
  let lastUserIdx = -1;
  for (let idx = 0; idx < messages.length; idx += 1) {
    if (messages[idx]?.role === "user") lastUserIdx = idx;
  }
  if (lastUserIdx < 0) return false;
  for (let idx = lastUserIdx + 1; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (!msg) continue;
    if (msg.role === "tool") return true;
    if (msg.role === "assistant") {
      const toolCalls = (msg.tool_calls as unknown[] | undefined) ?? [];
      if (toolCalls.length > 0) return true;
    }
  }
  return false;
}

/**
 * True when a newer user turn started after this todo snapshot (and no newer
 * todo_write replaced it — caller should pass the latest picked snapshot index).
 */
export function isTodoSnapshotSuperseded(messages: Message[], todoIndex: number): boolean {
  if (todoIndex < 0 || todoIndex >= messages.length) return false;
  for (let i = todoIndex + 1; i < messages.length; i += 1) {
    if (messages[i]?.role === "user") return true;
  }
  return false;
}

const TODO_COMPLETED_RE = /\((\d+)\s*\/\s*(\d+)\s*completed\)/;

/** Reasoning that plans tool/file work the model did not start in the same turn. */
const REASONING_ACTION_INTENT_RE =
  /让我先|我先|接下来要|然后加载|然后调用|去读取|去加载|todo_write/i;

/** Visible body that defers work to a follow-up step instead of delivering it. */
const DEFERRAL_BODY_RE = /我先|让我先|接下来|稍等|正在|马上/;

/**
 * Explicit handoff / step-entry phrases — strict mirror of backend
 * `_HANDOFF_BODY_RE` in `agenticx/studio/session_manager.py`.
 * Keep both sides in sync; any change here MUST be reflected on the backend.
 */
const HANDOFF_BODY_RE =
  /我现在进入第[一二三四五六七八九十0-9]+[项步阶段点]|现在开始(?:进行|优化|处理|执行|动手)|让我开始(?:进行|优化|处理|执行|动手)|我(?:现在)?去(?:读取|加载|执行|处理|优化|改|看)|我来(?:试试|看看|读取|加载|执行|改|优化)|接下来我(?:就|来|去|会)(?:读取|执行|改|优化|开始)/;

const HANDOFF_BODY_MAX_CHARS = 300;

function assistantReasoningText(message: Message): string {
  if (message.role !== "assistant") return "";
  return parseReasoningContent(message.content).reasoning.trim();
}

function messageHasTerminalMarkers(message: Message): boolean {
  const sq = message.suggestedQuestions;
  if (Array.isArray(sq) && sq.some((x) => String(x ?? "").trim())) return true;
  return String(message.content ?? "").toLowerCase().includes("</followups>");
}

/**
 * True when the last user turn ended on an assistant stub that promised tool/file
 * work (in reasoning) but emitted no tool_calls and no follow-up tool rows —
 * common when switching models or when a provider returns FINAL too early.
 */
export function lastTurnPromisedActionWithoutFollowThrough(messages: Message[]): boolean {
  if (!messages.length) return false;
  let lastUserIdx = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === "user") lastUserIdx = i;
  }
  if (lastUserIdx < 0) return false;
  const tail = messages.slice(lastUserIdx + 1);
  if (!tail.length) return false;
  const last = tail[tail.length - 1];
  if (last?.role !== "assistant") return false;
  const toolCalls = (last.tool_calls as unknown[] | undefined) ?? [];
  if (toolCalls.length > 0) return false;
  if (messageHasTerminalMarkers(last)) return false;
  const reasoning = assistantReasoningText(last);
  const body = assistantBodyText(last);

  // Path A: reasoning promises action + deferring short body.
  if (reasoning && REASONING_ACTION_INTENT_RE.test(reasoning)) {
    if (DEFERRAL_BODY_RE.test(body) && body.length < 220) return true;
    if (looksLikeUnfinishedAssistantBody(body)) return true;
  }

  // Path B/C: explicit handoff in body, no tool rows in this turn.
  if (body && HANDOFF_BODY_RE.test(body) && body.length < HANDOFF_BODY_MAX_CHARS) {
    const hasToolRow = tail.some((m) => m?.role === "tool");
    if (!hasToolRow) return true;
  }

  return false;
}

/** Extract the (done, total) counts from a todo snapshot tool message body. */
function parseTodoCompletedCounts(content: string): { done: number; total: number } | null {
  const match = content.match(TODO_COMPLETED_RE);
  if (!match) return null;
  const done = parseInt(match[1] ?? "", 10);
  const total = parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return { done, total };
}

/**
 * Returns true when triggering a resume/continuation would be futile:
 * the last turn_interrupted follows a complete assistant reply, there
 * are no pending (non-done) tool rows, and the latest todo snapshot
 * shows all items completed. In that state, resuming only makes the
 * model re-announce "task done" and re-verify outputs — a known loop.
 */
export function isFutileResume(messages: Message[]): boolean {
  if (!messages.length) return false;

  // Locate the last turn_interrupted tool message.
  let lastInterruptedIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (
      m?.role === "tool" &&
      (m.metadata as Record<string, unknown> | undefined)?.kind === "turn_interrupted"
    ) {
      lastInterruptedIdx = i;
      break;
    }
  }
  if (lastInterruptedIdx < 0) return false;

  // Only treat interruptions in the active (last user) turn as futile.
  let lastUserIdx = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === "user") lastUserIdx = i;
  }
  if (lastInterruptedIdx < lastUserIdx) return false;

  // The turn before the interruption must have produced a complete
  // assistant reply — otherwise a resume is genuinely needed.
  const beforeInterrupt = messages.slice(0, lastInterruptedIdx);
  if (!lastTurnHasCompletedAssistantReply(beforeInterrupt)) return false;

  // Reject if any tool row in the last turn is still pending/running.
  for (let i = 0; i < beforeInterrupt.length; i += 1) {
    const m = beforeInterrupt[i];
    if (m?.role !== "tool") continue;
    const status = (m.toolStatus ?? "").trim();
    if (status === "pending" || status === "running") return false;
  }

  // The most recent todo snapshot before the interruption must show
  // all items completed. Conservative: if no snapshot found, allow resume.
  for (let i = lastInterruptedIdx - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== "tool") continue;
    const counts = parseTodoCompletedCounts(String(m.content ?? ""));
    if (counts) {
      return counts.done === counts.total;
    }
  }
  return false;
}

/** Whether desktop auto-nudge may fire for the current stall + execution state. */
export function shouldAllowStallAutoNudge(
  stallState: StallPhase,
  executionState: string | undefined,
  budgetExceeded = false,
  ctx?: StallAutoNudgeContext,
): boolean {
  if (budgetExceeded) return false;
  if (stallState !== "stall") return false;
  const state = (executionState || "").trim();
  if (state === "running" || state === "interrupted") return true;
  if (state === "idle") {
    // Channel C (idle, no live SSE): manual recovery only — auto /continue pollutes
    // completed sessions after app restart when stall was a false positive.
    if (!ctx?.sseActive && !ctx?.runInFlight) return false;
    return true;
  }
  return false;
}

/**
 * Align sticky task bar with session execution: when the agent is no longer
 * running but todo_write still has in_progress, stop ghost spinners.
 *
 * Engineering fallback for "model forgot to call todo_write at the end":
 * when `promotePending` is true (caller has verified the agent continued
 * working after the last todo snapshot AND produced a complete final
 * assistant reply), residual `pending` items are also promoted to
 * `completed`. This prevents the sticky bar from being stuck at e.g. 1/2
 * after the agent actually delivered everything but skipped the closing
 * todo update.
 */
export function resolveStickyTodoDisplay(
  parsed: ParsedTodo,
  liveness: "active" | "stalled" | "idle",
  executionState?: string,
  opts?: { promotePending?: boolean }
): ParsedTodo {
  if (liveness === "active" || liveness === "stalled") {
    return parsed;
  }
  const state = (executionState || "").trim();
  const promotePending = !!opts?.promotePending && state !== "interrupted";
  const items: TodoItem[] = parsed.items.map((item) => {
    if (item.status === "in_progress") {
      if (state === "interrupted") {
        return { ...item, status: "pending" };
      }
      if (promotePending) {
        return { ...item, status: "completed" };
      }
      return { ...item, status: "pending" };
    }
    if (item.status === "pending" && promotePending) {
      return { ...item, status: "completed" };
    }
    return item;
  });
  const completed = items.filter((item) => item.status === "completed").length;
  const total = parsed.total > 0 ? parsed.total : items.length;
  return { items, completed, total };
}

/**
 * True when the displayed session changed and the pane must reset its
 * per-session transient stall detectors (silence clock / stallState /
 * prevExecutionState). Without this, a still-running (and possibly hung)
 * background session leaks its "已停滞 Ns / 该任务可能已中断" state onto a
 * sibling session that already finished, because those detectors live on the
 * single ChatPane instance and are not keyed per session.
 */
export function shouldResetStallDetectorsOnSessionSwitch(
  prevSessionId: string | undefined,
  nextSessionId: string | undefined,
): boolean {
  const prev = (prevSessionId || "").trim();
  const next = (nextSessionId || "").trim();
  if (!next) return false;
  return prev !== next;
}

/**
 * True only when the displayed session's messages are confirmed hydrated, i.e.
 * we actually have this session's persisted turns in memory (not the empty
 * window that exists between `setPaneSessionId` clearing `messages: []` and the
 * async re-load completing). Channel C must never fire while unhydrated — an
 * empty array is indistinguishable from "no completed reply", which is exactly
 * how a *completed* session gets a false「已停滞 / 已中断」when the user switches
 * back to it while another session hogs the single backend event loop.
 */
export function sessionMessagesHydrated(opts: {
  loadingMessages?: boolean;
  messageCount: number;
}): boolean {
  if (opts.loadingMessages) return false;
  return opts.messageCount > 0;
}

/** While the user requested stop, suppress stall re-detection until execution settles. */
export function shouldSuppressStallDetection(
  runGuardSessionId: string | undefined,
  sessionId: string,
  userStopped?: boolean
): boolean {
  const sid = (sessionId || "").trim();
  if (!sid) return false;
  if (userStopped) return true;
  const guard = (runGuardSessionId || "").trim();
  return Boolean(guard && guard === sid);
}

/**
 * Channel C: session ended idle but the last user turn has no completed
 * assistant reply.
 *
 * `messagesHydrated` (default true for callers/tests that pass real history)
 * gates the whole check: while the displayed session's messages are not yet
 * hydrated (switch clears `messages: []` then re-loads async), an empty array
 * must NOT be read as "no completed reply" — that is the root false-positive
 * that makes a completed session show「已停滞 / 该任务可能已中断」when switched
 * back to while another session is running.
 */
export function shouldTriggerIncompleteEndStall(
  executionState: string | undefined,
  sseActive: boolean,
  messages: Message[],
  graceElapsedMs: number,
  messagesHydrated = true,
): boolean {
  if (sseActive) return false;
  if (graceElapsedMs < CHANNEL_C_GRACE_MS) return false;
  if (!messagesHydrated) return false;
  const state = (executionState || "").trim();
  // Only idle — user-interrupted sessions are handled via userStopped stall suppress.
  if (state !== "idle") return false;
  // Tail pagination may briefly serve a tool-only slice before re-expand; without
  // a user anchor we cannot judge turn completeness — never flag stall.
  if (!messages.some((m) => m?.role === "user")) return false;
  if (isFutileResume(messages)) return false;
  if (lastTurnPromisedActionWithoutFollowThrough(messages)) return true;
  return !lastTurnHasCompletedAssistantReply(messages);
}

/** Fast fallback model suggestions when current model stalls (display labels). */
export const STALL_MODEL_FALLBACKS: Array<{ provider: string; model: string; label: string }> = [
  { provider: "deepseek", model: "deepseek-chat", label: "DeepSeek / deepseek-chat" },
  { provider: "zhipu", model: "glm-4-flash", label: "智谱 / glm-4-flash" },
  { provider: "openai", model: "gpt-4o-mini", label: "OpenAI / gpt-4o-mini" },
];

export type SilenceTier = "thinking" | "slow" | "stuck";

export type SessionHealth = "normal" | "slow" | "stuck";

/** Map silent seconds to UI tier (threshold = stall_detect_silence_seconds). */
export function resolveSilenceTier(
  silentSeconds: number,
  thresholdSeconds: number,
): SilenceTier {
  const threshold = Math.max(1, thresholdSeconds);
  const silent = Math.max(0, silentSeconds);
  if (silent <= threshold) return "thinking";
  if (silent <= threshold * 2) return "slow";
  return "stuck";
}

export function resolveSilenceTierLabel(
  tier: SilenceTier,
  silentSeconds: number,
): string {
  if (tier === "thinking") return "正在思考…";
  if (tier === "slow") return `模型响应较慢（已等 ${silentSeconds}s）`;
  return `可能已卡住（已等 ${silentSeconds}s）`;
}

export function resolveSessionHealth(
  silentSeconds: number,
  thresholdSeconds: number,
  executionState?: string,
  stallState?: StallPhase,
): SessionHealth {
  const state = (executionState || "").trim();
  if (stallState === "stall" || stallState === "exhausted") return "stuck";
  if (state !== "running") return "normal";
  const tier = resolveSilenceTier(silentSeconds, thresholdSeconds);
  if (tier === "stuck") return "stuck";
  if (tier === "slow") return "slow";
  return "normal";
}

const DISK_WRITE_PATH_RE =
  /(?:OK:\s*(?:wrote|saved|updated)|file_write|wrote\s+(?:to\s+)?)[`'"]?\s*([^\s`"'\n]+)/gi;
const FILENAME_HINT_RE =
  /([A-Za-z0-9_./-]+\.(?:md|txt|py|json|yaml|yml|sh|ts|tsx|js|jsx|xlsx|xls|csv|docx|pptx|pdf|html|htm|svg|mmd))/gi;

/** bash/skill JSON stdout: "output": "/abs/file.ext" */
const JSON_OUTPUT_PATH_RE =
  /"output"\s*:\s*"(\/(?:Users|home|tmp|var|opt|private|Volumes)[^"\s]+|[a-zA-Z]:[\\/][^"\s]+|~\/[^"\s]+)"/gi;

/** Todo prose keywords → expected artifact extensions (no filename in the todo text). */
const TODO_ARTIFACT_SEMANTICS: Array<{ cue: RegExp; exts: RegExp }> = [
  { cue: /excel|xlsx|报价表|电子表格/i, exts: /\.xlsx?$/i },
  { cue: /csv|表格导出/i, exts: /\.csv$/i },
  { cue: /pptx|幻灯片|演示文稿/i, exts: /\.pptx?$/i },
];

/** Collect filesystem paths mentioned in successful tool writes. */
export function extractDiskWritePathsFromMessages(messages: Message[]): string[] {
  const paths = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    const content = typeof msg.content === "string" ? msg.content : "";
    if (!content) continue;
    let match: RegExpExecArray | null;
    DISK_WRITE_PATH_RE.lastIndex = 0;
    while ((match = DISK_WRITE_PATH_RE.exec(content)) !== null) {
      const raw = match[1]?.trim().replace(/[.,;)]+$/, "");
      if (raw) paths.add(raw);
    }
    JSON_OUTPUT_PATH_RE.lastIndex = 0;
    while ((match = JSON_OUTPUT_PATH_RE.exec(content)) !== null) {
      const raw = match[1]?.trim().replace(/[.,;)]+$/, "");
      if (raw && /\.[a-zA-Z0-9]{1,12}$/.test(raw.split(/[/\\]/).pop() || "")) {
        paths.add(raw);
      }
    }
    if ((msg.toolName || "").trim() === "file_write" && !content.startsWith("ERROR")) {
      const abs = content.match(/\/[\w./+-]+\.[A-Za-z0-9]+/g);
      abs?.forEach((p) => paths.add(p));
    }
  }
  return [...paths];
}

function filenameHints(text: string): string[] {
  const hints: string[] = [];
  let match: RegExpExecArray | null;
  FILENAME_HINT_RE.lastIndex = 0;
  while ((match = FILENAME_HINT_RE.exec(text)) !== null) {
    const token = match[1]?.trim();
    if (token && !hints.includes(token)) hints.push(token);
  }
  const bare = text.trim().split(/[/\\]/).pop();
  if (bare && bare.includes(".") && !hints.includes(bare)) hints.push(bare);
  return hints;
}

function todoMatchesWrittenPath(todoContent: string, path: string): boolean {
  const pathNorm = path.replace(/\\/g, "/");
  const base = pathNorm.split("/").pop() || "";
  const hints = filenameHints(todoContent);
  if (
    hints.some((hint) => {
      const hintNorm = hint.replace(/\\/g, "/");
      return (
        pathNorm.includes(hintNorm) ||
        pathNorm.endsWith(hintNorm) ||
        base === hintNorm.split("/").pop()
      );
    })
  ) {
    return true;
  }
  return TODO_ARTIFACT_SEMANTICS.some(
    ({ cue, exts }) => cue.test(todoContent) && exts.test(base),
  );
}

/** Promote sticky todos when in_progress items match on-disk write evidence. */
export function detectDiskEvidenceForInProgressTodos(
  messages: Message[],
  parsed: ParsedTodo,
): boolean {
  const inProgress = parsed.items.filter((item) => item.status === "in_progress");
  if (inProgress.length === 0) return false;
  const paths = extractDiskWritePathsFromMessages(messages);
  if (paths.length === 0) return false;
  const normalized = paths.map((p) => p.replace(/\\/g, "/"));
  return inProgress.every((item) =>
    normalized.some((path) => todoMatchesWrittenPath(item.content, path)),
  );
}

/**
 * Detect "agent forgot to mark todos completed at the end".
 *
 * Conditions (run must already be idle — caller gates on liveness):
 * - There is a substantial final assistant reply after the last todo_write
 *   (not a short "我即将…" announcement).
 *
 * Covers the common anti-pattern:
 *   bash_exec (produce file) → todo_write(last=in_progress) → final assistant
 * where no tool follows the last todo snapshot (legacy code required a later
 * tool call and therefore missed this case).
 */
export function detectModelForgotFinalTodoUpdate(
  messages: Message[],
  lastTodoIndex: number,
): boolean {
  if (lastTodoIndex < 0 || lastTodoIndex >= messages.length - 1) return false;
  let lastAssistant: Message | undefined;
  for (let i = lastTodoIndex + 1; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "assistant" && m.id !== "__stream__") {
      lastAssistant = m;
    }
  }
  if (!messageLooksLikeAssistantFinal(lastAssistant)) return false;
  const body = assistantBodyText(lastAssistant!);
  if (body.length < 150) return false;
  return true;
}
