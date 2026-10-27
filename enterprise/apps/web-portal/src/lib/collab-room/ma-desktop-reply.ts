import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { log } from "../observability/logger";
import { buildRoomContextText, maNotices, summarizeManagedEvents } from "./ma-agent-reply";
import {
  archiveMaSession,
  createMaSession,
  MaRuntimeError,
  postMaEvents,
  streamMaEvents,
  type MaDesktopRoutingConfig,
  type MaRuntimeConfig,
  type MaWireEvent,
} from "./ma-runtime-client";
import type { CollabRoomContext, CollabRoomMessage, CollabRoomStore, CollabSenderType } from "./types";

export const MA_DESKTOP_STREAM_RECONNECTS = 2;

export const maDesktopNotices = {
  queued: "当前没有在线的桌面执行端，任务已排队",
  unclaimed: (name: string) => `智能体「${name}」没有桌面执行端接单，本次任务已取消`,
} as const;

export type ManagedDesktopReplyDeps = {
  config: MaRuntimeConfig;
  desktop: MaDesktopRoutingConfig;
  fetchImpl: typeof fetch;
  appendMessage: CollabRoomStore["appendMessage"];
};

export type ManagedDesktopReplyOutcome = { kind: "handled" } | { kind: "fallback"; reason: string };

/** 托管桌面路径只接管 runtime 为 desktop_worker 的 Agent。 */
export function isManagedDesktopEligible(agent: Pick<EnterpriseAgent, "runtime">): boolean {
  return agent.runtime === "desktop_worker";
}

function statusOf(error: unknown): number {
  return error instanceof MaRuntimeError ? error.status : 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function userMessage(text: string): Record<string, unknown> {
  return { type: "user.message", content: [{ type: "text", text }] };
}

function stopReasonType(event: MaWireEvent): string | null {
  const stop = event.stop_reason;
  if (!stop || typeof stop !== "object" || Array.isArray(stop)) return null;
  const kind = (stop as Record<string, unknown>).type;
  return typeof kind === "string" ? kind : null;
}

function noticeForStop(name: string, stopType: string | null): string {
  if (stopType === "policy_blocked") return maNotices.policyBlocked(name);
  if (stopType === "budget_exceeded") return maNotices.budgetExceeded(name);
  return maNotices.unavailable(name);
}

function logDesktopIssue(
  event: string,
  roomId: string,
  agentId: string,
  maSessionId: string,
  error: unknown,
  fallbackReason: string,
): void {
  log("warn", {
    event,
    room_id: roomId,
    agent_id: agentId,
    ma_session_id: maSessionId,
    status: statusOf(error),
    reason: error instanceof MaRuntimeError && error.code ? error.code : fallbackReason,
  });
}

async function appendNotice(
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

export async function runManagedDesktopReply(params: {
  ctx: CollabRoomContext;
  roomId: string;
  session: AuthContext;
  agent: EnterpriseAgent;
  trigger: CollabRoomMessage;
  history: CollabRoomMessage[];
  deps: ManagedDesktopReplyDeps;
}): Promise<ManagedDesktopReplyOutcome> {
  const { ctx, roomId, session, agent, trigger, history, deps } = params;
  const { config, desktop, fetchImpl } = deps;
  const name = agent.displayName;

  let created: { id: string; agentVersion: number };
  try {
    created = await createMaSession(
      config,
      { agentId: agent.id, onBehalfOf: session.userId, title: `协作房间 ${roomId}` },
      fetchImpl,
    );
  } catch (error) {
    return { kind: "fallback", reason: `create_failed:${statusOf(error)}` };
  }

  let stored: MaWireEvent[];
  try {
    stored = await postMaEvents(
      config,
      created.id,
      [userMessage(buildRoomContextText(agent, history, trigger))],
      fetchImpl,
    );
  } catch (error) {
    await archiveMaSession(config, created.id, fetchImpl).catch((archiveError: unknown) => {
      logDesktopIssue(
        "room.agent_reply.ma_desktop_archive_failed",
        roomId,
        agent.id,
        created.id,
        archiveError,
        "archive_failed",
      );
    });
    return { kind: "fallback", reason: `post_failed:${statusOf(error)}` };
  }

  const userSeq = stored[0]?.seq ?? 0;
  const controller = new AbortController();
  const replyTimer = setTimeout(() => controller.abort(), desktop.replyTimeoutMs);
  let sawRunning = false;
  let noticePosted = false;
  const noticeTimer = setTimeout(() => {
    if (sawRunning || noticePosted) return;
    noticePosted = true;
    void appendNotice(ctx, roomId, maDesktopNotices.queued, deps.appendMessage).catch((error: unknown) => {
      logDesktopIssue(
        "room.agent_reply.ma_desktop_notice_failed",
        roomId,
        agent.id,
        created.id,
        error,
        "notice_failed",
      );
    });
  }, desktop.claimNoticeMs);

  const collected: MaWireEvent[] = [];
  let cursor = userSeq;
  let interrupted = false;
  let reconnects = 0;
  let done = false;

  const interrupt = async (): Promise<void> => {
    try {
      await postMaEvents(config, created.id, [{ type: "user.interrupt" }], fetchImpl);
    } catch (error) {
      logDesktopIssue(
        "room.agent_reply.ma_desktop_interrupt_failed",
        roomId,
        agent.id,
        created.id,
        error,
        "interrupt_failed",
      );
    }
  };

  try {
    while (!done) {
      try {
        for await (const event of streamMaEvents(
          config,
          created.id,
          { afterSeq: cursor, signal: controller.signal },
          fetchImpl,
        )) {
          if (event.seq <= cursor) continue;
          cursor = event.seq;
          collected.push(event);
          if (event.type === "session.status_running") {
            sawRunning = true;
            continue;
          }
          if (event.type !== "session.status_idle") continue;
          if (stopReasonType(event) === "requires_action") {
            if (!interrupted) {
              interrupted = true;
              await interrupt();
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
        if (reconnects > MA_DESKTOP_STREAM_RECONNECTS) {
          logDesktopIssue(
            "room.agent_reply.ma_desktop_stream_failed",
            roomId,
            agent.id,
            created.id,
            error,
            "stream_failed",
          );
          await appendNotice(ctx, roomId, maNotices.unavailable(name), deps.appendMessage);
          return { kind: "handled" };
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      if (sawRunning) {
        await interrupt();
        await appendNotice(ctx, roomId, maNotices.timeout(name), deps.appendMessage);
      } else {
        await archiveMaSession(config, created.id, fetchImpl).catch((archiveError: unknown) => {
          logDesktopIssue(
            "room.agent_reply.ma_desktop_archive_failed",
            roomId,
            agent.id,
            created.id,
            archiveError,
            "archive_failed",
          );
        });
        await appendNotice(ctx, roomId, maDesktopNotices.unclaimed(name), deps.appendMessage);
      }
      return { kind: "handled" };
    }
    throw error;
  } finally {
    clearTimeout(replyTimer);
    clearTimeout(noticeTimer);
  }

  const summary = summarizeManagedEvents(collected);
  if (summary.requiresAction) {
    await appendNotice(ctx, roomId, maNotices.needsConfirmation(name), deps.appendMessage);
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
        runtime: "desktop_worker",
        reply_to: trigger.id,
        ma_session_id: created.id,
        agent_version: created.agentVersion,
        ...(summary.steps.length > 0 ? { tool_steps: summary.steps } : {}),
      },
    });
    return { kind: "handled" };
  }
  await appendNotice(ctx, roomId, noticeForStop(name, summary.stopType), deps.appendMessage);
  return { kind: "handled" };
}
