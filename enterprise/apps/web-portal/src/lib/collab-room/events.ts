import type { CollabRoomMessage } from "./types";

export type CollabRoomEvent =
  | { type: "room_cursor"; last_seq: number }
  | { type: "room_message"; message: CollabRoomMessage }
  | { type: "room_ping"; at: string }
  | { type: "room_closed"; reason: "timeout" | "gone" };

/** SSE 帧：event: <name> + data: <json>，末尾空行。 */
export function formatCollabRoomEventSse(event: CollabRoomEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
