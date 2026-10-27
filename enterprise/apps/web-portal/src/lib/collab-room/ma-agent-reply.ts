import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { log } from "../observability/logger";
import { knowledgeSearchUrl } from "./agent-knowledge";
import {
  createMaSession,
  postMaEvents,
  streamMaEvents,
  MaRuntimeError,
  type MaRuntimeConfig,
  type MaWireEvent,
} from "./ma-runtime-client";
import type { CollabRoomContext, CollabRoomMessage, CollabRoomStore, CollabSenderType } from "./types";

export const MA_CONTEXT_MESSAGE_LIMIT = 30;
export const MA_CONTENT_LIMIT = 4000;
export const MA_STREAM_RECONNECTS = 2;

export const maNotices = {
  modelDenied: (name: string) => `智能体「${name}」使用的模型对你不可用，请联系管理员`,
  unavailable: (name: string) => `智能体「${name}」暂时不可用，请稍后再试`,
  timeout: (name: string) => `智能体「${name}」处理超时，请稍后再试`,
  needsConfirmation: (name: string) => `智能体「${name}」需要人工确认才能继续，协作房间暂不支持确认，本次回复已中止`,
  policyBlocked: (name: string) => `智能体「${name}」的请求触发合规拦截`,
  budgetExceeded: (name: string) => `智能体「${name}」本次用量已达上限，请联系管理员`,
} as const;

export type ManagedToolStep = { tool: string; server: string; ok: boolean; durationMs: number };

export type ManagedReplyDeps = {
  config: MaRuntimeConfig;
  fetchImpl: typeof fetch;
  appendMessage: CollabRoomStore["appendMessage"];
  listAvailableModels: (session: AuthContext) => Promise<string[]>;
};

export type ManagedReplyOutcome = { kind: "handled" } | { kind: "fallback"; reason: string };

type OpenTool = { tool: string; server: string; startedAt: number };

/** 托管路径只接管：cloud 运行方式、无 mcp: 能力、无知识库检索地址的 Agent。 */
export function isManagedEligible(agent: Pick<EnterpriseAgent, "runtime" | "capabilityIds" | "metadata">): boolean {
  return (
    agent.runtime === "cloud" &&
    !agent.capabilityIds.some((id) => id.trim().startsWith("mcp:")) &&
    !knowledgeSearchUrl(agent)
  );
}

function clip(content: string): string {
  if (content.length <= MA_CONTENT_LIMIT) return content;
  return `${content.slice(0, MA_CONTENT_LIMIT)}…`;
}

function senderLabel(message: CollabRoomMessage): string {
  const name = message.sender_name?.trim();
  return name ? name : message.sender_id;
}

/** 纯函数：拼进 user.message 的房间上下文。 */
export function buildRoomContextText(
  agent: Pick<EnterpriseAgent, "id" | "displayName">,
  history: CollabRoomMessage[],
  trigger: CollabRoomMessage,
): string {
  const prior = history
    .filter((item) => item.id !== trigger.id)
    .slice()
    .sort((left, right) => left.seq - right.seq)
    .slice(-MA_CONTEXT_MESSAGE_LIMIT);
  const lines =
    prior.length === 0
      ? ["（无）"]
      : prior.map((item) => {
          const text = clip(item.content);
          if (item.sender_type === "agent" && item.sender_id === agent.id) {
            return `你（${agent.displayName}）：${text}`;
          }
          return `${senderLabel(item)}：${text}`;
        });
  return [
    "[协作房间]",
    `你是协作房间里的智能体「${agent.displayName}」，房间里有多个成员，回复简洁并指明回应对象。`,
    "[最近消息]",
    ...lines,
    "[需要你回复的消息]",
    `${senderLabel(trigger)}：${clip(trigger.content)}`,
  ].join("\n");
}

function messageText(event: MaWireEvent): string {
  const content = event.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
  }
  return parts.join("\n").trim();
}

function stopReasonType(event: MaWireEvent): string | null {
  const stop = event.stop_reason;
  if (!stop || typeof stop !== "object") return null;
  const kind = (stop as Record<string, unknown>).type;
  return typeof kind === "string" ? kind : null;
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  return Date.parse(value);
}

/** 纯函数：从本次回复的事件序列提取最终文本、工具摘要和停止原因。 */
export function summarizeManagedEvents(events: MaWireEvent[]): {
  finalText: string;
  steps: ManagedToolStep[];
  stopType: string | null;
  requiresAction: boolean;
} {
  const open = new Map<string, OpenTool>();
  const steps: ManagedToolStep[] = [];
  let finalText = "";
  let stopType: string | null = null;
  let requiresAction = false;

  for (const event of events) {
    if (event.type === "agent.message") {
      finalText = messageText(event);
      continue;
    }
    if (event.type === "agent.tool_use" || event.type === "agent.mcp_tool_use") {
      if (typeof event.id !== "string" || !event.id) continue;
      const name = event.name;
      open.set(event.id, {
        tool: typeof name === "string" ? name : "",
        server: event.type === "agent.mcp_tool_use" ? String(event.mcp_server) : "builtin",
        startedAt: parseTimestamp(event.created_at),
      });
      continue;
    }
    if (event.type === "agent.tool_result" || event.type === "agent.mcp_tool_result") {
      const refKey = event.type === "agent.tool_result" ? "tool_use_id" : "mcp_tool_use_id";
      const ref = event[refKey];
      if (typeof ref !== "string") continue;
      const found = open.get(ref);
      if (!found) continue;
      open.delete(ref);
      const endedAt = parseTimestamp(event.created_at);
      const durationMs =
        Number.isNaN(found.startedAt) || Number.isNaN(endedAt) ? 0 : Math.max(0, endedAt - found.startedAt);
      steps.push({
        tool: found.tool,
        server: found.server,
        ok: event.is_error !== true,
        durationMs,
      });
      continue;
    }
    if (event.type === "session.status_idle") {
      const kind = stopReasonType(event);
      stopType = kind;
      if (kind === "requires_action") requiresAction = true;
    }
  }

  return { finalText, steps, stopType, requiresAction };
}

function statusOf(error: unknown): number {
  return error instanceof MaRuntimeError ? error.status : 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function logFallback(roomId: string, agentId: string, reason: string, maSessionId?: string): void {
  log("warn", {
    event: "room.agent_reply.ma_fallback",
    room_id: roomId,
    agent_id: agentId,
    ...(maSessionId ? { ma_session_id: maSessionId } : {}),
    reason,
  });
}

async function appendSystemNotice(
  ctx: CollabRoomContext,
  roomId: string,
  content: string,
  append: CollabRoomStore["appendMessage"],
): Promise<void> {
  await append(ctx, roomId, {
    senderType: "system" as CollabSenderType,
    senderId: "system",
    senderName: "系统",
    content,
  });
}

async function interruptSession(
  deps: ManagedReplyDeps,
  roomId: string,
  agentId: string,
  maSessionId: string,
): Promise<void> {
  try {
    await postMaEvents(deps.config, maSessionId, [{ type: "user.interrupt" }], deps.fetchImpl);
  } catch (error) {
    log("warn", {
      event: "room.agent_reply.ma_interrupt_failed",
      room_id: roomId,
      agent_id: agentId,
      ma_session_id: maSessionId,
      status: statusOf(error),
      reason: error instanceof MaRuntimeError ? (error.code ?? "interrupt_failed") : "interrupt_failed",
    });
  }
}

function noticeForStop(name: string, stopType: string | null): string {
  if (stopType === "policy_blocked") return maNotices.policyBlocked(name);
  if (stopType === "budget_exceeded") return maNotices.budgetExceeded(name);
  return maNotices.unavailable(name);
}

export async function runManagedAgentReply(params: {
  ctx: CollabRoomContext;
  roomId: string;
  session: AuthContext;
  agent: EnterpriseAgent;
  trigger: CollabRoomMessage;
  history: CollabRoomMessage[];
  deps: ManagedReplyDeps;
}): Promise<ManagedReplyOutcome> {
  const { ctx, roomId, session, agent, trigger, history, deps } = params;
  const name = agent.displayName;

  let visible: string[];
  try {
    visible = await deps.listAvailableModels(session);
  } catch {
    const reason = "model_check_failed";
    logFallback(roomId, agent.id, reason);
    return { kind: "fallback", reason };
  }
  if (!visible.includes(agent.model)) {
    await appendSystemNotice(ctx, roomId, maNotices.modelDenied(name), deps.appendMessage);
    return { kind: "handled" };
  }

  let created: { id: string; agentVersion: number };
  try {
    created = await createMaSession(
      deps.config,
      { agentId: agent.id, onBehalfOf: session.userId, title: `协作房间 ${roomId}` },
      deps.fetchImpl,
    );
  } catch (error) {
    const reason = `create_failed:${statusOf(error)}`;
    logFallback(roomId, agent.id, reason);
    return { kind: "fallback", reason };
  }

  let stored: MaWireEvent[];
  try {
    stored = await postMaEvents(
      deps.config,
      created.id,
      [
        {
          type: "user.message",
          content: [{ type: "text", text: buildRoomContextText(agent, history, trigger) }],
        },
      ],
      deps.fetchImpl,
    );
  } catch (error) {
    const reason = `post_failed:${statusOf(error)}`;
    logFallback(roomId, agent.id, reason, created.id);
    return { kind: "fallback", reason };
  }

  const rawSeq = stored[0]?.seq;
  const userSeq = typeof rawSeq === "number" ? rawSeq : 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.config.replyTimeoutMs);
  const collected: MaWireEvent[] = [];
  let cursor = userSeq;
  let interrupted = false;
  let reconnects = 0;
  let done = false;

  try {
    while (!done) {
      try {
        for await (const event of streamMaEvents(
          deps.config,
          created.id,
          { afterSeq: cursor, signal: controller.signal },
          deps.fetchImpl,
        )) {
          if (event.seq <= cursor) continue;
          cursor = event.seq;
          collected.push(event);
          if (event.type !== "session.status_idle") continue;
          const stop = stopReasonType(event);
          if (stop === "requires_action") {
            if (!interrupted) {
              interrupted = true;
              await interruptSession(deps, roomId, agent.id, created.id);
            }
            continue;
          }
          done = true;
          break;
        }
        if (!done) throw new MaRuntimeError("stream ended early", 0, null);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw error;
        reconnects += 1;
        if (reconnects > MA_STREAM_RECONNECTS) {
          log("warn", {
            event: "room.agent_reply.ma_stream_failed",
            room_id: roomId,
            agent_id: agent.id,
            ma_session_id: created.id,
            status: statusOf(error),
            reason: error instanceof MaRuntimeError && error.code ? error.code : "stream_failed",
          });
          await appendSystemNotice(ctx, roomId, maNotices.unavailable(name), deps.appendMessage);
          return { kind: "handled" };
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      await interruptSession(deps, roomId, agent.id, created.id);
      await appendSystemNotice(ctx, roomId, maNotices.timeout(name), deps.appendMessage);
      return { kind: "handled" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const summary = summarizeManagedEvents(collected);
  if (summary.requiresAction) {
    await appendSystemNotice(ctx, roomId, maNotices.needsConfirmation(name), deps.appendMessage);
    return { kind: "handled" };
  }
  if (summary.finalText) {
    await deps.appendMessage(ctx, roomId, {
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.displayName,
      content: summary.finalText,
      model: agent.model,
      metadata: {
        agent_slug: agent.slug,
        runtime: "cloud",
        reply_to: trigger.id,
        ma_session_id: created.id,
        agent_version: created.agentVersion,
        ...(summary.steps.length > 0 ? { tool_steps: summary.steps } : {}),
      },
    });
    return { kind: "handled" };
  }
  await appendSystemNotice(ctx, roomId, noticeForStop(name, summary.stopType), deps.appendMessage);
  return { kind: "handled" };
}
