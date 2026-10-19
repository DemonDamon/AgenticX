import { ulid } from "ulid";
import { NextResponse } from "next/server";
import { isValidUlid } from "../../../../../../lib/chat-history";
import { getRoom, listMessages, type CollabRoomMessage } from "../../../../../../lib/collab-room";
import { collabRoomBadRequest } from "../../../../../../lib/collab-room-http";
import { requestMetaReply } from "../../../../../../lib/collab-room/meta-reply";
import { listAvailableModelsForUser } from "../../../../../../lib/admin-providers-reader";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import {
  desktopAuthContext,
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
  resolveDesktopGatewayToken,
} from "../../../../../../lib/desktop-collab-room-http";

type Params = Promise<{ roomId: string }>;

const SUMMARY_SYSTEM_PROMPT = "把下面的群聊整理成：结论、决定、待办（含负责人）三部分，简洁、不编造";
const RECENT_LIMIT = 200;
const PAGE_LIMIT = 500;
const PAGE_CAP = 40;

function summaryUnavailable(): NextResponse {
  return NextResponse.json(
    { error: { code: "50301", message: "智能体暂时不可用" } },
    { status: 503 },
  );
}

function readMessageIds(value: unknown): string[] | undefined | "invalid" {
  if (value == null) return undefined;
  if (!Array.isArray(value)) return "invalid";
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isValidUlid(item.trim())) return "invalid";
    ids.push(item.trim());
  }
  return ids;
}

async function loadSummaryMessages(
  ctx: { tenantId: string; userId: string },
  roomId: string,
  messageIds: string[] | undefined,
): Promise<CollabRoomMessage[]> {
  const room = await getRoom(ctx, roomId);
  if (!messageIds || messageIds.length === 0) {
    const afterSeq = Math.max(0, room.last_seq - RECENT_LIMIT);
    return listMessages(ctx, roomId, { afterSeq, limit: RECENT_LIMIT });
  }
  const wanted = new Set(messageIds);
  const found = new Map<string, CollabRoomMessage>();
  let afterSeq = 0;
  for (let page = 0; page < PAGE_CAP && found.size < wanted.size; page += 1) {
    const batch = await listMessages(ctx, roomId, { afterSeq, limit: PAGE_LIMIT });
    if (batch.length === 0) break;
    for (const message of batch) {
      if (wanted.has(message.id)) found.set(message.id, message);
    }
    const tail = batch[batch.length - 1];
    if (!tail || batch.length < PAGE_LIMIT) break;
    afterSeq = tail.seq;
  }
  const ordered: CollabRoomMessage[] = [];
  for (const id of messageIds) {
    const message = found.get(id);
    if (!message) return [];
    ordered.push(message);
  }
  return ordered;
}

export async function POST(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();
  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");

  let body: { message_ids?: unknown } = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as { message_ids?: unknown };
    } catch {
      return collabRoomBadRequest("invalid json body");
    }
  }
  const messageIds = readMessageIds(body.message_ids);
  if (messageIds === "invalid") return collabRoomBadRequest("invalid message_ids");

  const ctx = desktopRoomContext(identity);
  let messages: CollabRoomMessage[];
  try {
    if (messageIds && messageIds.length > 0) {
      const loaded = await loadSummaryMessages(ctx, roomId, messageIds);
      if (loaded.length !== messageIds.length) {
        return collabRoomBadRequest("message is not in the source room");
      }
      messages = loaded;
    } else {
      messages = await loadSummaryMessages(ctx, roomId, undefined);
    }
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }

  try {
    const models = await listAvailableModelsForUser(identity.userId, identity.email, identity.deptId);
    const first = models[0];
    if (!first) return summaryUnavailable();
    const accessToken = await resolveDesktopGatewayToken(identity);
    if (!accessToken) return summaryUnavailable();

    const session = desktopAuthContext(identity);
    const [providerId, ...rest] = first.id.split("/");
    const modelName = rest.join("/") || first.model;
    const transcript = [...messages]
      .sort((a, b) => a.seq - b.seq)
      .map((item) => `${item.sender_name}：${item.content}`)
      .join("\n");
    const summary = await requestMetaReply(
      [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: transcript || "（无消息）" },
      ],
      {
        gatewayUrl:
          process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions",
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
          "x-agenticx-trace-stage": "room.summary",
          ...(providerId ? { "x-agenticx-provider": providerId } : {}),
        },
      },
    );
    return NextResponse.json({ code: "00000", message: "ok", data: { summary } });
  } catch {
    return summaryUnavailable();
  }
}
