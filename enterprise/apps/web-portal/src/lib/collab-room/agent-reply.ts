import { ulid } from "ulid";
import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import type { CollabRoomContext, CollabRoomMessage, CollabRoomStore, CollabSenderType } from "./types";
import { requestMetaReply } from "./meta-reply";

export type AgentReplyDeps = {
  listMessages: CollabRoomStore["listMessages"];
  appendMessage: CollabRoomStore["appendMessage"];
  requestReply: typeof requestMetaReply;
  getAccessToken: () => Promise<string | null>;
  gatewayUrl: string;
  fetchImpl?: typeof fetch;
};

const CONTENT_LIMIT = 4000;

function clipContent(content: string): string {
  if (content.length <= CONTENT_LIMIT) return content;
  return `${content.slice(0, CONTENT_LIMIT)}…`;
}

function modelDenied(name: string): string {
  return `智能体「${name}」使用的模型对你不可用，请联系管理员`;
}

function unavailable(name: string): string {
  return `智能体「${name}」暂时不可用，请稍后再试`;
}

function desktopPending(name: string): string {
  return `智能体「${name}」需要员工桌面执行，桌面执行通道尚未接入`;
}

function gatewayStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const matched = /^gateway status (\d+)$/.exec(error.message);
  const raw = matched?.[1];
  if (!raw) return null;
  const status = Number(raw);
  return Number.isInteger(status) ? status : null;
}

function buildCloudAgentPrompt(
  agent: EnterpriseAgent,
  history: CollabRoomMessage[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const roomNote = `你是协作房间里的智能体「${agent.displayName}」，房间里有多个成员，回复简洁并指明回应对象`;
  const systemText = agent.systemPrompt.trim() ? `${agent.systemPrompt.trim()}\n${roomNote}` : roomNote;
  const ordered = history.slice().sort((left, right) => left.seq - right.seq).slice(-30);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemText },
  ];
  for (const item of ordered) {
    if (item.sender_type === "agent" && item.sender_id === agent.id) {
      messages.push({ role: "assistant", content: clipContent(item.content) });
      continue;
    }
    const name = item.sender_name?.trim() || item.sender_id;
    messages.push({ role: "user", content: `${name}：${clipContent(item.content)}` });
  }
  return messages;
}

async function appendSystemNotice(
  ctx: CollabRoomContext,
  roomId: string,
  content: string,
  append: AgentReplyDeps["appendMessage"],
): Promise<void> {
  await append(ctx, roomId, {
    senderType: "system" as CollabSenderType,
    senderId: "system",
    senderName: "系统",
    content,
  });
}

async function resolveAgentReplyDeps(overrides?: Partial<AgentReplyDeps>): Promise<AgentReplyDeps> {
  const needsStore = !overrides?.listMessages || !overrides?.appendMessage;
  const needsToken = overrides?.getAccessToken == null;
  // index 会拉起数据库适配器；测试注入了存储依赖时不加载，避免环和真实连接。
  const store = needsStore ? await import("./index") : null;
  const sessionMod = needsToken ? await import("../session") : null;
  return {
    listMessages: overrides?.listMessages ?? store!.listMessages,
    appendMessage: overrides?.appendMessage ?? store!.appendMessage,
    requestReply: overrides?.requestReply ?? requestMetaReply,
    getAccessToken:
      overrides?.getAccessToken ??
      (async () => {
        const auth = await sessionMod!.getSessionAuthFromCookies();
        return auth?.accessToken ?? null;
      }),
    gatewayUrl:
      overrides?.gatewayUrl ??
      process.env.GATEWAY_COMPLETIONS_URL ??
      "http://127.0.0.1:8088/v1/chat/completions",
    fetchImpl: overrides?.fetchImpl,
  };
}

async function triggerCloudAgentReply(
  ctx: CollabRoomContext,
  roomId: string,
  session: AuthContext,
  agent: EnterpriseAgent,
  triggerMessage: CollabRoomMessage,
  deps: AgentReplyDeps,
): Promise<void> {
  const history = await deps.listMessages(ctx, roomId, { limit: 30 });
  const accessToken = await deps.getAccessToken();
  if (!accessToken) {
    await appendSystemNotice(ctx, roomId, unavailable(agent.displayName), deps.appendMessage);
    return;
  }
  const [providerId, ...rest] = agent.model.split("/");
  const modelName = rest.join("/") || agent.model;
  try {
    const reply = await deps.requestReply(buildCloudAgentPrompt(agent, history), {
      gatewayUrl: deps.gatewayUrl,
      model: modelName,
      fetchImpl: deps.fetchImpl,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "x-tenant-id": session.tenantId,
        "x-user-id": session.userId,
        "x-dept-id": session.deptId ?? "",
        "x-user-email": session.email,
        "x-session-id": session.sessionId,
        "x-agenticx-trace-id": ulid().toLowerCase(),
        "x-agenticx-trace-step": "1",
        "x-agenticx-trace-stage": "room.agent",
        "x-agenticx-agent-id": agent.id,
        ...(providerId ? { "x-agenticx-provider": providerId } : {}),
      },
    });
    await deps.appendMessage(ctx, roomId, {
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.displayName,
      content: reply,
      model: agent.model,
      metadata: {
        agent_slug: agent.slug,
        runtime: "cloud",
        reply_to: triggerMessage.id,
      },
    });
  } catch (error) {
    const status = gatewayStatus(error);
    const content = status === 401 || status === 403 ? modelDenied(agent.displayName) : unavailable(agent.displayName);
    await appendSystemNotice(ctx, roomId, content, deps.appendMessage);
  }
}

export async function dispatchAgentMention(
  ctx: CollabRoomContext,
  roomId: string,
  session: AuthContext,
  agent: EnterpriseAgent,
  triggerMessage: CollabRoomMessage,
  overrides?: Partial<AgentReplyDeps>,
): Promise<void> {
  const deps = await resolveAgentReplyDeps(overrides);
  switch (agent.runtime) {
    case "cloud":
      await triggerCloudAgentReply(ctx, roomId, session, agent, triggerMessage, deps);
      return;
    case "desktop_worker":
      await appendSystemNotice(ctx, roomId, desktopPending(agent.displayName), deps.appendMessage);
      return;
    default: {
      const _never: never = agent.runtime;
      throw new Error(`unsupported agent runtime: ${String(_never)}`);
    }
  }
}
