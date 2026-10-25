import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../observability/logger";
import {
  __resetMaRuntimeConfigWarningForTests,
  archiveMaSession,
  createMaSession,
  MaRuntimeError,
  MA_ON_BEHALF_OF_HEADER,
  parseSseStream,
  resolveMaDesktopRoutingConfig,
  resolveMaRuntimeConfig,
  streamMaEvents,
  type MaRuntimeConfig,
} from "../ma-runtime-client";

vi.mock("../../observability/logger", () => ({
  log: vi.fn(),
}));

const SID = "01SESSION0AAAAAAAAAAAAAAAA";
const USER_ID = "01HZX3NDEKTSV4RRFFQ69G5FAV";

function chunkStream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

async function collectFrames(parts: string[]) {
  const frames = [];
  for await (const frame of parseSseStream(chunkStream(parts))) frames.push(frame);
  return frames;
}

describe("ma runtime client", () => {
  beforeEach(() => {
    __resetMaRuntimeConfigWarningForTests();
    vi.mocked(log).mockClear();
  });

  afterEach(() => {
    __resetMaRuntimeConfigWarningForTests();
  });

  it("resolveMaRuntimeConfig", async () => {
    expect(resolveMaRuntimeConfig({})).toBeNull();
    expect(vi.mocked(log)).not.toHaveBeenCalled();

    expect(resolveMaRuntimeConfig({ MA_RUNTIME_ENABLED: "1", MA_RUNTIME_SERVICE_TOKEN: "agx-pat-x" })).toEqual({ // gitleaks:allow
      baseUrl: "http://127.0.0.1:8092",
      serviceToken: "agx-pat-x", // gitleaks:allow
      replyTimeoutMs: 180000,
    });
    expect(
      resolveMaRuntimeConfig({
        MA_RUNTIME_ENABLED: "1",
        MA_RUNTIME_SERVICE_TOKEN: "agx-pat-x", // gitleaks:allow
        MA_RUNTIME_URL: "http://rt:8092/",
      })?.baseUrl,
    ).toBe("http://rt:8092");

    const dir = mkdtempSync(join(tmpdir(), "ma-e04-"));
    const file = join(dir, "service.pat");
    try {
      writeFileSync(file, "agx-pat-f\n", "utf8");
      expect(
        resolveMaRuntimeConfig({
          MA_RUNTIME_ENABLED: "1",
          MA_RUNTIME_SERVICE_TOKEN: "agx-pat-env", // gitleaks:allow
          MA_RUNTIME_SERVICE_TOKEN_FILE: file,
        })?.serviceToken,
      ).toBe("agx-pat-f");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(resolveMaRuntimeConfig({ MA_RUNTIME_ENABLED: "1", MA_RUNTIME_SERVICE_TOKEN: "abc" })).toBeNull();
    expect(vi.mocked(log)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log)).toHaveBeenCalledWith("warn", {
      event: "room.agent_reply.ma_config_invalid",
      reason: "invalid_service_token",
    });
    expect(resolveMaRuntimeConfig({ MA_RUNTIME_ENABLED: "1", MA_RUNTIME_SERVICE_TOKEN: "abc" })).toBeNull();
    expect(vi.mocked(log)).toHaveBeenCalledTimes(1);

    const enabled = { MA_RUNTIME_ENABLED: "1", MA_RUNTIME_SERVICE_TOKEN: "agx-pat-x" }; // gitleaks:allow
    expect(resolveMaRuntimeConfig({ ...enabled, MA_RUNTIME_REPLY_TIMEOUT_MS: "10" })?.replyTimeoutMs).toBe(5000);
    expect(resolveMaRuntimeConfig({ ...enabled, MA_RUNTIME_REPLY_TIMEOUT_MS: "99999999" })?.replyTimeoutMs).toBe(1800000);
    expect(resolveMaRuntimeConfig({ ...enabled, MA_RUNTIME_REPLY_TIMEOUT_MS: "x" })?.replyTimeoutMs).toBe(180000);
  });

  it("parseSseStream", async () => {
    const parts = [": ping\n\n", 'id: 3\nevent: agent.message\ndata: {"a"', ":1}\n\n"];
    const frames = await collectFrames(parts);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.id).toBe("3");
    expect(frames[0]?.event).toBe("agent.message");
    expect(JSON.parse(frames[0]?.data ?? "")).toEqual({ a: 1 });

    const crlf = parts.map((part) => part.replaceAll("\n", "\r\n"));
    const crlfFrames = await collectFrames(crlf);
    expect(crlfFrames).toEqual(frames);

    const joined = await collectFrames(["data: x\ndata: y\n\n"]);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.data).toBe("x\ny");

    const unnamed = await collectFrames(["data: hello\n\n"]);
    expect(unnamed[0]?.event).toBe("message");

    const comments = await collectFrames([": ping\n\n: keep-alive\n\n"]);
    expect(comments).toEqual([]);
  });

  it("createMaSession sends service token and on-behalf-of", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: SID, agent_version: 2 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const config: MaRuntimeConfig = { baseUrl: "http://rt", serviceToken: "agx-pat-x", replyTimeoutMs: 5000 }; // gitleaks:allow
    const created = await createMaSession(
      config,
      { agentId: "01AGENT0AAAAAAAAAAAAAAAAAA", onBehalfOf: USER_ID, title: "协作房间 room-1" },
      fetchImpl,
    );
    expect(created).toEqual({ id: SID, agentVersion: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("http://rt/ma/v1/sessions");
    expect(call?.[1]?.method).toBe("POST");
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer agx-pat-x");
    expect(headers[MA_ON_BEHALF_OF_HEADER]).toBe(USER_ID);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      agent_id: "01AGENT0AAAAAAAAAAAAAAAAAA",
      source: "portal",
      title: "协作房间 room-1",
    });
  });

  it("maps error body to MaRuntimeError", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "agent_version_not_found", message: "agent version not found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    const config: MaRuntimeConfig = { baseUrl: "http://rt", serviceToken: "agx-pat-x", replyTimeoutMs: 5000 }; // gitleaks:allow
    let caught: unknown;
    try {
      await createMaSession(config, { agentId: "01AGENT0AAAAAAAAAAAAAAAAAA", onBehalfOf: USER_ID, title: "t" }, fetchImpl);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MaRuntimeError);
    const error = caught as MaRuntimeError;
    expect(error.status).toBe(404);
    expect(error.code).toBe("agent_version_not_found");
    expect(String(error)).not.toContain("agx-pat-x");
  });

  it("streamMaEvents builds after_seq query and skips frames without seq", async () => {
    const sse = [
      ": ping\n\n",
      'event: event_delta\ndata: {"type":"event_delta"}\n\n',
      'id: 6\nevent: agent.message\ndata: {"id":"e6","seq":6,"type":"agent.message"}\n\n',
    ].join("");
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const config: MaRuntimeConfig = { baseUrl: "http://rt", serviceToken: "agx-pat-x", replyTimeoutMs: 5000 }; // gitleaks:allow
    const events = [];
    for await (const event of streamMaEvents(config, SID, { afterSeq: 5, signal: new AbortController().signal }, fetchImpl)) {
      events.push(event);
    }
    const call = fetchImpl.mock.calls[0];
    expect(String(call?.[0])).toContain("?after_seq=5");
    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(6);
    expect(events[0]?.type).toBe("agent.message");
  });
});

describe("resolveMaDesktopRoutingConfig", () => {
  const base: MaRuntimeConfig = { baseUrl: "http://rt", serviceToken: "agx-pat-x", replyTimeoutMs: 5000 }; // gitleaks:allow

  it("returns null unless desktop routing is on and clamps both timeouts", () => {
    vi.mocked(log).mockClear();
    expect(resolveMaDesktopRoutingConfig(null, { MA_RUNTIME_DESKTOP_ROUTING: "1" })).toBeNull();
    expect(resolveMaDesktopRoutingConfig(base, {})).toBeNull();
    expect(vi.mocked(log)).not.toHaveBeenCalled();

    expect(resolveMaDesktopRoutingConfig(base, { MA_RUNTIME_DESKTOP_ROUTING: "1" })).toEqual({
      replyTimeoutMs: 600000,
      claimNoticeMs: 15000,
    });
    expect(
      resolveMaDesktopRoutingConfig(base, {
        MA_RUNTIME_DESKTOP_ROUTING: "1",
        MA_RUNTIME_DESKTOP_REPLY_TIMEOUT_MS: "10",
      })?.replyTimeoutMs,
    ).toBe(5000);
    expect(
      resolveMaDesktopRoutingConfig(base, {
        MA_RUNTIME_DESKTOP_ROUTING: "1",
        MA_RUNTIME_DESKTOP_REPLY_TIMEOUT_MS: "99999999",
      })?.replyTimeoutMs,
    ).toBe(1800000);
    expect(
      resolveMaDesktopRoutingConfig(base, {
        MA_RUNTIME_DESKTOP_ROUTING: "1",
        MA_RUNTIME_DESKTOP_REPLY_TIMEOUT_MS: "x",
      })?.replyTimeoutMs,
    ).toBe(600000);
    expect(
      resolveMaDesktopRoutingConfig(base, {
        MA_RUNTIME_DESKTOP_ROUTING: "1",
        MA_RUNTIME_DESKTOP_CLAIM_NOTICE_MS: "1",
      })?.claimNoticeMs,
    ).toBe(1000);
    expect(
      resolveMaDesktopRoutingConfig(base, {
        MA_RUNTIME_DESKTOP_ROUTING: "1",
        MA_RUNTIME_DESKTOP_CLAIM_NOTICE_MS: "999999",
      })?.claimNoticeMs,
    ).toBe(120000);
  });
});

describe("archiveMaSession", () => {
  it("posts archive without a body and maps errors without the token", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const config: MaRuntimeConfig = { baseUrl: "http://rt", serviceToken: "agx-pat-x", replyTimeoutMs: 5000 }; // gitleaks:allow
    await archiveMaSession(config, SID, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe(`http://rt/ma/v1/sessions/${SID}/archive`);
    expect(call?.[1]?.method).toBe("POST");
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer agx-pat-x");
    expect(headers[MA_ON_BEHALF_OF_HEADER]).toBeUndefined();
    expect(headers["content-type"]).toBeUndefined();
    expect(call?.[1]?.body).toBeUndefined();

    const denied = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "invalid_request", message: "session is running" } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    let caught: unknown;
    try {
      await archiveMaSession(config, SID, denied);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MaRuntimeError);
    const error = caught as MaRuntimeError;
    expect(error.status).toBe(409);
    expect(error.code).toBe("invalid_request");
    expect(String(error)).not.toContain("agx-pat-x");
  });
});
