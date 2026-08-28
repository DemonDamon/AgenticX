import { ulid } from "ulid";
import type { AuthContext } from "@agenticx/auth";
import type { PortalModelOption } from "../admin-providers-reader";
import type { CollabRoomContext, CollabRoomMessage, CollabRoomStore, CollabSenderType } from "./types";

export type MetaReplyDeps = {
  gatewayUrl: string;
  headers: Record<string, string>;
  model: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type TriggerMetaReplyDeps = {
  listMessages: CollabRoomStore["listMessages"];
  appendMessage: CollabRoomStore["appendMessage"];
  listAvailableModelsForUser: (
    userId: string,
    email?: string,
    deptId?: string | null,
  ) => Promise<PortalModelOption[]>;
  requestMetaReply: typeof requestMetaReply;
  getAccessToken: () => Promise<string | null>;
  gatewayUrl: string;
};

const SYSTEM_UNAVAILABLE = "智能体暂时不可用，请稍后再试";
const SYSTEM_NO_MODEL = "智能体暂时不可用（未配置可用模型）";
const CONTENT_LIMIT = 4000;

/** 房间里是否点名了 Meta。大小写不敏感；要求 @ 紧邻 meta。 */
export function mentionsMeta(content: string): boolean {
  return /(^|[\s，,。.:：;；!！?？(（])@meta\b/i.test(content);
}

function clipContent(content: string): string {
  if (content.length <= CONTENT_LIMIT) return content;
  return `${content.slice(0, CONTENT_LIMIT)}…`;
}

export function buildMetaPrompt(
  history: CollabRoomMessage[],
  limit = 30,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const ordered = history.slice().sort((a, b) => a.seq - b.seq).slice(-limit);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content:
        "你是这个协作房间里的助手 Meta，房间里有多个真人成员，回复要简洁、指明你在回应谁。",
    },
  ];
  for (const item of ordered) {
    if (item.sender_type === "meta") {
      messages.push({ role: "assistant", content: clipContent(item.content) });
      continue;
    }
    const name = item.sender_name?.trim() || item.sender_id;
    messages.push({ role: "user", content: `${name}：${clipContent(item.content)}` });
  }
  return messages;
}

export async function requestMetaReply(
  prompt: Array<{ role: string; content: string }>,
  deps: MetaReplyDeps,
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(deps.gatewayUrl, {
    method: "POST",
    headers: deps.headers,
    body: JSON.stringify({
      model: deps.model,
      stream: false,
      messages: prompt,
    }),
    signal: deps.signal,
  });
  if (!response.ok) {
    throw new Error(`gateway status ${response.status}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("empty gateway content");
  }
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return stripped || content.trim();
}

async function appendSystemNotice(
  ctx: CollabRoomContext,
  roomId: string,
  content: string,
  append: TriggerMetaReplyDeps["appendMessage"],
): Promise<void> {
  await append(ctx, roomId, {
    senderType: "system" as CollabSenderType,
    senderId: "system",
    senderName: "系统",
    content,
  });
}

async function resolveDeps(overrides?: Partial<TriggerMetaReplyDeps>): Promise<TriggerMetaReplyDeps> {
  const needsStore = !overrides?.listMessages || !overrides?.appendMessage;
  const needsModels = !overrides?.listAvailableModelsForUser;
  const needsToken = !overrides?.getAccessToken;
  const store = needsStore ? await import("./index") : null;
  const models = needsModels ? await import("../admin-providers-reader") : null;
  const sessionMod = needsToken ? await import("../session") : null;
  return {
    listMessages: overrides?.listMessages ?? store!.listMessages,
    appendMessage: overrides?.appendMessage ?? store!.appendMessage,
    listAvailableModelsForUser:
      overrides?.listAvailableModelsForUser ?? models!.listAvailableModelsForUser,
    requestMetaReply: overrides?.requestMetaReply ?? requestMetaReply,
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
  };
}

export async function triggerMetaReply(
  ctx: CollabRoomContext,
  roomId: string,
  session: AuthContext,
  overrides?: Partial<TriggerMetaReplyDeps>,
): Promise<void> {
  const deps = await resolveDeps(overrides);
  const history = await deps.listMessages(ctx, roomId, { limit: 30 });
  const models = await deps.listAvailableModelsForUser(session.userId, session.email, session.deptId);
  const first = models[0];
  if (!first) {
    await appendSystemNotice(ctx, roomId, SYSTEM_NO_MODEL, deps.appendMessage);
    return;
  }
  const accessToken = await deps.getAccessToken();
  if (!accessToken) {
    await appendSystemNotice(ctx, roomId, SYSTEM_UNAVAILABLE, deps.appendMessage);
    return;
  }
  const [providerId, ...rest] = first.id.split("/");
  const modelName = rest.join("/") || first.model;
  try {
    const reply = await deps.requestMetaReply(buildMetaPrompt(history), {
      gatewayUrl: deps.gatewayUrl,
      model: modelName,
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
        "x-agenticx-trace-stage": "room.meta",
        ...(providerId ? { "x-agenticx-provider": providerId } : {}),
      },
    });
    await deps.appendMessage(ctx, roomId, {
      senderType: "meta",
      senderId: "meta",
      senderName: "Meta",
      content: reply,
      model: first.id,
    });
  } catch {
    await appendSystemNotice(ctx, roomId, SYSTEM_UNAVAILABLE, deps.appendMessage);
  }
}
