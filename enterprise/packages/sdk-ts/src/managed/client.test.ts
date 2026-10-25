import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedAgentsClient } from "./client";
import { MaApiError } from "./errors";
import type { MaStreamItem } from "./types";

const casesPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../tests/fixtures/managed_agents/client_cases.json",
);
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as {
  error_conflict: { error: { code: string; message: string; details: { current_latest_version: number } } };
  stream_part1: string;
  stream_part2: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function collect(client: ManagedAgentsClient, sessionId: string, opts?: Parameters<ManagedAgentsClient["events"]["stream"]>[1]) {
  const items: MaStreamItem[] = [];
  for await (const item of client.events.stream(sessionId, opts)) items.push(item);
  return items;
}

describe("ManagedAgentsClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes control and runtime calls", async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers) });
      const url = String(input);
      if (url.endsWith("/agents")) return jsonResponse({ data: [] });
      if (url.endsWith("/sessions") && init?.method === "POST") return jsonResponse({ id: "created" });
      return jsonResponse({ id: "S" });
    });

    const client = new ManagedAgentsClient({
      baseUrl: "https://ent.example.com",
      token: "agx-pat-t", // gitleaks:allow
      fetch: fetchMock,
    });
    await client.agents.list();
    expect(seen[0]?.url).toBe("https://ent.example.com/ma/v1/agents");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer agx-pat-t");

    seen.length = 0;
    const dev = new ManagedAgentsClient({
      baseUrl: "http://127.0.0.1",
      controlBaseUrl: "http://127.0.0.1:3001/api",
      runtimeBaseUrl: "http://127.0.0.1:8092",
      token: "agx-pat-t", // gitleaks:allow
      onBehalfOf: "user-1",
      fetch: fetchMock,
    });
    await dev.agents.list();
    await dev.sessions.get("S");
    await dev.sessions.create({ agent_id: "A" });
    expect(seen.map((item) => item.url)).toEqual([
      "http://127.0.0.1:3001/api/ma/v1/agents",
      "http://127.0.0.1:8092/ma/v1/sessions/S",
      "http://127.0.0.1:8092/ma/v1/sessions",
    ]);
    expect(seen.every((item) => item.headers.get("authorization") === "Bearer agx-pat-t")).toBe(true);
    expect(seen[0]?.headers.get("x-agenticx-on-behalf-of")).toBeNull();
    expect(seen[1]?.headers.get("x-agenticx-on-behalf-of")).toBeNull();
    expect(seen[2]?.headers.get("x-agenticx-on-behalf-of")).toBe("user-1");

    expect(() => new ManagedAgentsClient({ baseUrl: "https://ent.example.com", token: "abc" })).toThrow(MaApiError);
    try {
      new ManagedAgentsClient({ baseUrl: "https://ent.example.com", token: "abc" });
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_token" });
    }
  });

  it("maps error bodies", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(cases.error_conflict, 409));
    const client = new ManagedAgentsClient({
      baseUrl: "https://ent.example.com",
      token: "agx-pat-t", // gitleaks:allow
      fetch: fetchMock,
    });
    await expect(
      client.versions.create("A", { manifest: {}, expectedLatestVersion: 2 }),
    ).rejects.toMatchObject({
      status: 409,
      code: "agent_version_conflict",
      details: { current_latest_version: 3 },
    });

    const failing = vi.fn(async () => {
      throw new TypeError("socket hang up agx-pat-t");
    });
    const networked = new ManagedAgentsClient({
      baseUrl: "https://ent.example.com",
      token: "agx-pat-t", // gitleaks:allow
      fetch: failing,
    });
    await expect(networked.agents.list()).rejects.toMatchObject({ status: 0, code: "network_error" });
    try {
      await networked.agents.list();
    } catch (error) {
      expect(String(error)).not.toContain("agx-pat-t");
      expect(error instanceof Error ? error.message : "").not.toContain("agx-pat-t");
    }
  });

  it("resumes with Last-Event-ID", async () => {
    const headers: Headers[] = [];
    let call = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      call += 1;
      const body = call === 1 ? cases.stream_part1 : cases.stream_part2;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const client = new ManagedAgentsClient({
      baseUrl: "https://ent.example.com",
      token: "agx-pat-t", // gitleaks:allow
      fetch: fetchMock,
    });
    const items = await collect(client, "S", { untilIdle: true });
    const events = items.filter((item) => item.kind === "event");
    expect(events.map((item) => (item.kind === "event" ? item.event.seq : 0))).toEqual([2, 3, 4]);
    expect(items.some((item) => item.kind === "preview")).toBe(false);
    expect(headers[1]?.get("last-event-id")).toBe("3");
    expect(headers[0]?.get("last-event-id")).toBeNull();

    call = 0;
    headers.length = 0;
    const withPreview = await collect(client, "S", { untilIdle: true, includePreviews: true });
    expect(withPreview.filter((item) => item.kind === "preview")).toHaveLength(1);
    expect(
      withPreview.filter((item) => item.kind === "event").map((item) => (item.kind === "event" ? item.event.seq : 0)),
    ).toEqual([2, 3, 4]);
  });

  it("throws stream_disconnected after repeated failures and does not retry 404", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const client = new ManagedAgentsClient({
      baseUrl: "https://ent.example.com",
      token: "agx-pat-t", // gitleaks:allow
      fetch: fetchMock,
    });
    const pending = collect(client, "S", { maxReconnects: 5 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "stream_disconnected", status: 0 });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const missing = vi.fn(async () => jsonResponse({ error: { code: "session_not_found", message: "missing" } }, 404));
    const once = new ManagedAgentsClient({
      baseUrl: "https://ent.example.com",
      token: "agx-pat-t", // gitleaks:allow
      fetch: missing,
    });
    await expect(collect(once, "S")).rejects.toMatchObject({ status: 404, code: "session_not_found" });
    expect(missing).toHaveBeenCalledTimes(1);
  });
});
