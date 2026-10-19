import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueOutbox, listOutbox, setCollabCacheRootForTests, type OutboxItem } from "../electron/collab-cache";
import { sendMessage } from "../electron/collab-room-client";
import { flushOutbox, type OutboxFlushEvent } from "../electron/collab-outbox-flusher";

vi.mock("../electron/collab-room-client", () => ({
  sendMessage: vi.fn(),
}));

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";
const send = vi.mocked(sendMessage);

let dir = "";

function item(clientMsgId: string, content: string, createdAt: number): OutboxItem {
  return {
    client_msg_id: clientMsgId,
    room_id: ROOM,
    content,
    created_at: createdAt,
    attempts: 0,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-collab-outbox-"));
  setCollabCacheRootForTests(dir);
  send.mockReset();
});

afterEach(() => {
  setCollabCacheRootForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("collab outbox flusher", () => {
  it("sends queued messages in created_at order", async () => {
    enqueueOutbox(item("c", "c", 30));
    enqueueOutbox(item("a", "a", 10));
    enqueueOutbox(item("b", "b", 20));
    const sent: string[] = [];
    send.mockImplementation(async (_deps, _roomId, content, clientMsgId) => {
      sent.push(content);
      return { ok: true, data: { message: { seq: sent.length, content, client_msg_id: clientMsgId } } };
    });
    const events: OutboxFlushEvent[] = [];
    await flushOutbox({
      getDeps: () => ({ baseUrl: "https://p.example.com", token: "t" }),
      notify: (_roomId, event) => events.push(event),
    });
    expect(sent).toEqual(["a", "b", "c"]);
    expect(listOutbox(ROOM)).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(["outbox_sent", "outbox_sent", "outbox_sent"]);
  });

  it("stops the round on a network failure and resumes at that message", async () => {
    enqueueOutbox(item("a", "a", 1));
    enqueueOutbox(item("b", "b", 2));
    enqueueOutbox(item("c", "c", 3));
    let failSecond = true;
    const sent: string[] = [];
    send.mockImplementation(async (_deps, _roomId, content, clientMsgId) => {
      sent.push(content);
      if (content === "b" && failSecond) {
        return { ok: false, error: "云房间服务暂时不可用", status: null };
      }
      return { ok: true, data: { message: { seq: sent.length, content, client_msg_id: clientMsgId } } };
    });
    const notify = () => undefined;
    const getDeps = () => ({ baseUrl: "https://p.example.com", token: "t" });
    await flushOutbox({ getDeps, notify });
    expect(sent).toEqual(["a", "b"]);
    expect(listOutbox(ROOM).map((row) => row.content)).toEqual(["b", "c"]);
    expect(listOutbox(ROOM)[0]?.attempts).toBe(1);

    failSecond = false;
    sent.length = 0;
    await flushOutbox({ getDeps, notify });
    expect(sent).toEqual(["b", "c"]);
    expect(listOutbox(ROOM)).toEqual([]);
  });

  it("removes a 4xx message and emits outbox_failed without blocking the rest", async () => {
    enqueueOutbox(item("a", "a", 1));
    enqueueOutbox(item("b", "b", 2));
    enqueueOutbox(item("c", "c", 3));
    send.mockImplementation(async (_deps, _roomId, content, clientMsgId) => {
      if (content === "b") return { ok: false, error: "你已被移出该房间", status: 403 };
      return { ok: true, data: { message: { seq: 1, content, client_msg_id: clientMsgId } } };
    });
    const events: OutboxFlushEvent[] = [];
    await flushOutbox({
      getDeps: () => ({ baseUrl: "https://p.example.com", token: "t" }),
      notify: (_roomId, event) => events.push(event),
    });
    expect(listOutbox(ROOM)).toEqual([]);
    expect(events).toEqual([
      { type: "outbox_sent", client_msg_id: "a", message: { seq: 1, content: "a", client_msg_id: "a" } },
      { type: "outbox_failed", client_msg_id: "b", error: "你已被移出该房间" },
      { type: "outbox_sent", client_msg_id: "c", message: { seq: 1, content: "c", client_msg_id: "c" } },
    ]);
  });

  it("does nothing when the enterprise session is missing", async () => {
    enqueueOutbox(item("a", "a", 1));
    await flushOutbox({ getDeps: () => null, notify: () => undefined });
    expect(send).not.toHaveBeenCalled();
    expect(listOutbox(ROOM)).toHaveLength(1);
  });
});
