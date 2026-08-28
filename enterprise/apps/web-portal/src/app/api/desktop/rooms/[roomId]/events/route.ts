import { isValidUlid } from "../../../../../../lib/chat-history";
import {
  CollabRoomForbiddenError,
  CollabRoomNotFoundError,
  getRoom,
  listMessages,
} from "../../../../../../lib/collab-room";
import { formatCollabRoomEventSse } from "../../../../../../lib/collab-room/events";
import { collabRoomBadRequest } from "../../../../../../lib/collab-room-http";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import {
  desktopRoomContext,
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
} from "../../../../../../lib/desktop-collab-room-http";

export const runtime = "nodejs";
export const maxDuration = 300;

const POLL_MS = process.env.VITEST ? 15 : 1_000;
const PING_EVERY_MS = process.env.VITEST ? 80 : 15_000;

type Params = Promise<{ roomId: string }>;

export async function GET(request: Request, segmentData: { params: Params }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();

  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return collabRoomBadRequest("invalid room id");

  const ctx = desktopRoomContext(identity);
  const afterSeqParam = new URL(request.url).searchParams.get("after_seq");
  let cursor = afterSeqParam == null || afterSeqParam === "" ? 0 : Number(afterSeqParam);
  if (!Number.isInteger(cursor) || cursor < 0) {
    return collabRoomBadRequest("invalid after_seq");
  }

  let lastSeq = 0;
  try {
    const room = await getRoom(ctx, roomId);
    lastSeq = room.last_seq;
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }

  const encoder = new TextEncoder();
  const abortSignal = request.signal;

  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stop = () => {
        closed = true;
      };
      abortSignal.addEventListener("abort", stop);

      const safeEnqueue = (chunk: string) => {
        if (closed || abortSignal.aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      safeEnqueue(formatCollabRoomEventSse({ type: "room_cursor", last_seq: lastSeq }));

      const startedAt = Date.now();
      let lastPingAt = Date.now();
      try {
        while (!closed && !abortSignal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (closed || abortSignal.aborted) break;

          try {
            const batch = await listMessages(ctx, roomId, { afterSeq: cursor, limit: 200 });
            for (const message of batch) {
              safeEnqueue(formatCollabRoomEventSse({ type: "room_message", message }));
              cursor = Math.max(cursor, message.seq);
            }
            if (batch.length === 0 && Date.now() - lastPingAt >= PING_EVERY_MS) {
              safeEnqueue(
                formatCollabRoomEventSse({ type: "room_ping", at: new Date().toISOString() }),
              );
              lastPingAt = Date.now();
            }
          } catch (error) {
            if (
              error instanceof CollabRoomForbiddenError ||
              error instanceof CollabRoomNotFoundError
            ) {
              safeEnqueue(formatCollabRoomEventSse({ type: "room_closed", reason: "gone" }));
            }
            break;
          }

          if (Date.now() - startedAt >= (maxDuration - 10) * 1000) {
            safeEnqueue(formatCollabRoomEventSse({ type: "room_closed", reason: "timeout" }));
            break;
          }
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      } catch (error) {
        try {
          controller.error(error);
        } catch {
          /* ignore */
        }
      } finally {
        abortSignal.removeEventListener("abort", stop);
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
