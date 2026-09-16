import { describe, expect, it } from "vitest";
import {
  listRooms,
  mapCollabRoomHttpError,
  normalizePortalBase,
  parseSseChunk,
  sendMessage,
  streamRoomEvents,
} from "../electron/collab-room-client";

const DEPS_BASE = {
  baseUrl: "https://p.example.com",
  token: "agx-pat-test",
};

describe("collab-room-client", () => {
  it("normalizePortalBase trims and drops trailing slashes", () => {
    expect(normalizePortalBase("  https://p.example.com//  ")).toBe("https://p.example.com");
    expect(normalizePortalBase(undefined)).toBe("");
  });

  it("listRooms sends the PAT as a bearer token", async () => {
    let captured: RequestInit | undefined;
    const result = await listRooms({
      ...DEPS_BASE,
      fetchImpl: async (_url, init) => {
        captured = init;
        return new Response(JSON.stringify({ data: { rooms: [] } }), { status: 200 });
      },
    });
    expect(result.ok).toBe(true);
    const headers = captured?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer agx-pat-test");
  });

  it("sendMessage posts only the content field", async () => {
    let body: unknown;
    await sendMessage(
      {
        ...DEPS_BASE,
        fetchImpl: async (_url, init) => {
          body = JSON.parse(String(init?.body ?? "{}"));
          return new Response(JSON.stringify({ data: { message: { id: "m1" } } }), { status: 200 });
        },
      },
      "01R00M0AAAAAAAAAAAAAAAAAAA",
      "hello",
    );
    expect(body).toEqual({ content: "hello" });
    expect(Object.keys(body as object)).toEqual(["content"]);
  });

  it("maps 401 to a re-login message", async () => {
    const result = await listRooms({
      ...DEPS_BASE,
      fetchImpl: async () => new Response("nope", { status: 401 }),
    });
    expect(result).toEqual({ ok: false, error: "企业登录已失效，请重新登录" });
    expect(mapCollabRoomHttpError(401)).toBe("企业登录已失效，请重新登录");
  });

  it("maps 403 to a removed-from-room message", async () => {
    const result = await listRooms({
      ...DEPS_BASE,
      fetchImpl: async () => new Response("nope", { status: 403 }),
    });
    expect(result).toEqual({ ok: false, error: "你已被移出该房间" });
  });

  it("error messages never leak the portal url or token", async () => {
    for (const status of [401, 403, 404, 500, 502]) {
      const result = await listRooms({
        baseUrl: "https://secret.example.com",
        token: "agx-pat-secret",
        fetchImpl: async () =>
          new Response("https://secret.example.com leaked agx-pat-secret", { status }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.toLowerCase()).not.toContain("http");
      expect(result.error).not.toContain("agx-pat");
    }
  });

  it("parseSseChunk parses a complete frame", () => {
    const parsed = parseSseChunk('event: room_message\ndata: {"seq":3}\n\n');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.type).toBe("room_message");
    expect(parsed.events[0]?.data).toEqual({ seq: 3 });
    expect(parsed.rest).toBe("");
  });

  it("parseSseChunk keeps an incomplete tail for the next chunk", () => {
    const raw = 'event: room_message\ndata: {"seq":';
    const parsed = parseSseChunk(raw);
    expect(parsed.events).toEqual([]);
    expect(parsed.rest).toBe(raw);
  });

  it("parseSseChunk handles two frames in one chunk", () => {
    const parsed = parseSseChunk(
      'event: room_message\ndata: {"seq":1}\n\nevent: room_cursor\ndata: {"last_seq":1}\n\n',
    );
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]?.type).toBe("room_message");
    expect(parsed.events[1]?.type).toBe("room_cursor");
  });

  it("streamRoomEvents forwards parsed events in order", async () => {
    const chunks = [
      'event: room_message\ndata: {"seq":1',
      '}\n\nevent: room_message\ndata: {"seq":2}\n\nevent: room_message\ndata: {',
      '"seq":3}\n\n',
    ];
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[i]));
          i += 1;
          return;
        }
        controller.close();
      },
    });
    const seen: number[] = [];
    await streamRoomEvents(
      {
        ...DEPS_BASE,
        fetchImpl: async () => new Response(body, { status: 200 }),
      },
      "01R00M0AAAAAAAAAAAAAAAAAAA",
      {
        onEvent: (event) => {
          const seq = (event.data as { seq?: number }).seq;
          if (typeof seq === "number") seen.push(seq);
        },
        onClosed: () => undefined,
      },
      new AbortController().signal,
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it("streamRoomEvents reports closed when the body ends", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: room_cursor\ndata: {"last_seq":0}\n\n'));
        controller.close();
      },
    });
    let closed = 0;
    await streamRoomEvents(
      {
        ...DEPS_BASE,
        fetchImpl: async () => new Response(body, { status: 200 }),
      },
      "01R00M0AAAAAAAAAAAAAAAAAAA",
      {
        onEvent: () => undefined,
        onClosed: () => {
          closed += 1;
        },
      },
      new AbortController().signal,
    );
    expect(closed).toBe(1);
  });
});
