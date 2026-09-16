import { describe, expect, it } from "vitest";
import { formatCollabRoomEventSse, type CollabRoomEvent } from "./events";

const samples: CollabRoomEvent[] = [
  { type: "room_cursor", last_seq: 5 },
  {
    type: "room_message",
    message: {
      id: "01MSG0AAAAAAAAAAAAAAAAAAAA",
      room_id: "01R00M0AAAAAAAAAAAAAAAAAAA",
      tenant_id: "01TENANT0AAAAAAAAAAAAAAA",
      seq: 1,
      sender_type: "human",
      sender_id: "01HZX3NDEKTSV4RRFFQ69G5FAV",
      sender_name: "Alice",
      content: "hello",
      created_at: "2026-08-28T00:00:00.000Z",
    },
  },
  { type: "room_ping", at: "2026-08-28T00:00:00.000Z" },
  { type: "room_closed", reason: "gone" },
];

describe("formatCollabRoomEventSse", () => {
  it.each(samples)("formats $type with parseable data and trailing blank line", (event) => {
    const frame = formatCollabRoomEventSse(event);
    expect(frame.startsWith(`event: ${event.type}\n`)).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
    expect(dataLine).toBeTruthy();
    expect(JSON.parse(dataLine!.slice(6))).toEqual(event);
  });
});
