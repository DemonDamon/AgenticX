import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabRoomMessage } from "../../lib/collab-room/types";
import { createRoomStreamSession } from "./useRoomStream";

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";

class FakeEventSource {
  public static instances: FakeEventSource[] = [];
  public url: string;
  public onerror: ((ev: Event) => void) | null = null;
  public onopen: ((ev: Event) => void) | null = null;
  private readonly listeners = new Map<string, Set<(ev: MessageEvent) => void>>();

  public constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  public addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
  }

  public close() {
    /* no-op */
  }

  public emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }
}

function msg(partial: Partial<CollabRoomMessage> & Pick<CollabRoomMessage, "id" | "seq" | "content">): CollabRoomMessage {
  return {
    room_id: ROOM,
    tenant_id: "01TENANT0AAAAAAAAAAAAAAA",
    sender_type: "human",
    sender_id: "01HZX3NDEKTSV4RRFFQ69G5FAV",
    sender_name: "Alice",
    created_at: "2026-08-28T00:00:00.000Z",
    ...partial,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ code: status === 200 ? "00000" : "50001", data, error: status === 200 ? undefined : { message: "失败" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("useRoomStream", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedupes an optimistic message when the SSE echo arrives", async () => {
    const serverMsg = msg({ id: "01MSG0AAAAAAAAAAAAAAAAAAAA", seq: 1, content: "hi" });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return jsonResponse({ message: serverMsg });
      if (url.includes("/messages")) return jsonResponse({ messages: [] });
      return jsonResponse({});
    });
    const session = createRoomStreamSession({
      roomId: ROOM,
      fetchImpl: fetchImpl as typeof fetch,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });
    await session.start();
    await session.send("hi");
    FakeEventSource.instances[0]?.emit("room_message", { type: "room_message", message: serverMsg });
    expect(session.getMessages().filter((item) => item.id === serverMsg.id)).toHaveLength(1);
    session.dispose();
  });

  it("falls back to polling when EventSource errors", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/messages")) return jsonResponse({ messages: [] });
      return jsonResponse({});
    });
    const session = createRoomStreamSession({
      roomId: ROOM,
      fetchImpl: fetchImpl as typeof fetch,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });
    await session.start();
    const before = fetchImpl.mock.calls.length;
    FakeEventSource.instances[0]?.onerror?.(new Event("error"));
    expect(session.getStatus()).toBe("polling");
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(before);
    session.dispose();
  });

  it("stops reconnecting when room_closed gone is received", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/messages")) return jsonResponse({ messages: [] });
      return jsonResponse({});
    });
    const session = createRoomStreamSession({
      roomId: ROOM,
      fetchImpl: fetchImpl as typeof fetch,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });
    await session.start();
    const afterStart = fetchImpl.mock.calls.length;
    const afterConnect = FakeEventSource.instances.length;
    FakeEventSource.instances[0]?.emit("room_closed", { type: "room_closed", reason: "gone" });
    expect(session.getStatus()).toBe("revoked");
    FakeEventSource.instances[0]?.onerror?.(new Event("error"));
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchImpl.mock.calls.length).toBe(afterStart);
    expect(FakeEventSource.instances.length).toBe(afterConnect);
    session.dispose();
  });

  it("reconnects with the latest cursor after room_closed timeout", async () => {
    const incoming = msg({ id: "01MSG1AAAAAAAAAAAAAAAAAAAA", seq: 7, content: "later" });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/messages")) return jsonResponse({ messages: [msg({ id: "01MSG0AAAAAAAAAAAAAAAAAAAA", seq: 3, content: "old" })] });
      return jsonResponse({});
    });
    const session = createRoomStreamSession({
      roomId: ROOM,
      fetchImpl: fetchImpl as typeof fetch,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });
    await session.start();
    FakeEventSource.instances[0]?.emit("room_message", { type: "room_message", message: incoming });
    FakeEventSource.instances[0]?.emit("room_closed", { type: "room_closed", reason: "timeout" });
    expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(2);
    const latest = FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
    expect(latest.url).toContain("after_seq=7");
    session.dispose();
  });

  it("keeps input recoverable when send fails", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return jsonResponse({}, 500);
      if (url.includes("/messages")) return jsonResponse({ messages: [] });
      return jsonResponse({});
    });
    const session = createRoomStreamSession({
      roomId: ROOM,
      fetchImpl: fetchImpl as typeof fetch,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });
    await session.start();
    await expect(session.send("草稿")).rejects.toThrow();
    expect(session.getMessages()).toHaveLength(0);
    session.dispose();
  });
});
