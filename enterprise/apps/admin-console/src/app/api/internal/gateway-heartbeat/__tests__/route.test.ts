import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEARTBEAT_RETENTION_MS,
  __setGatewayInstanceRepositoryForTests,
  type GatewayInstanceRepository,
  type GatewayInstanceRow,
} from "../../../../../lib/gateway-instances-store";

const mocks = vi.hoisted(() => ({
  isGatewayInternalAuthorized: vi.fn(),
}));

vi.mock("../../../../../lib/gateway-internal-auth", () => ({
  isGatewayInternalAuthorized: (...args: unknown[]) => mocks.isGatewayInternalAuthorized(...args),
  gatewayInternalUnauthorized: () => Response.json({ code: "40101", message: "unauthorized" }, { status: 401 }),
}));

function memoryRepository() {
  const rows = new Map<string, GatewayInstanceRow>();
  const repo: GatewayInstanceRepository = {
    async upsert(row) {
      rows.set(row.instanceId, row);
    },
    async deleteLastSeenBefore(cutoff) {
      for (const [id, row] of rows) {
        if (row.lastSeenAt.getTime() < cutoff.getTime()) rows.delete(id);
      }
    },
    async list() {
      return [...rows.values()];
    },
  };
  return { rows, repo };
}

function heartbeat(instanceId: string, version: string) {
  return {
    instanceId,
    startedAt: "2026-11-09T00:00:00.000Z",
    domains: [
      { domain: "providers", version: "", lastError: "" },
      { domain: "channels", version: "", lastError: "" },
      { domain: "policy", version, lastError: "" },
      { domain: "mcp_servers", version: "", lastError: "" },
    ],
  };
}

describe("internal gateway heartbeat", () => {
  let memory = memoryRepository();

  beforeEach(() => {
    memory = memoryRepository();
    __setGatewayInstanceRepositoryForTests(memory.repo);
    mocks.isGatewayInternalAuthorized.mockReset();
    mocks.isGatewayInternalAuthorized.mockReturnValue(true);
  });

  afterEach(() => {
    __setGatewayInstanceRepositoryForTests(null);
  });

  it("returns 401 and does not write when the caller is unauthorized", async () => {
    mocks.isGatewayInternalAuthorized.mockReturnValue(false);
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example/api/internal/gateway-heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(heartbeat("gw-1", "pub-1")),
      }),
    );
    expect(response.status).toBe(401);
    expect(memory.rows.size).toBe(0);
  });

  it("writes one row and replaces it when the same instance reports again", async () => {
    const { POST } = await import("../route");
    const first = await POST(
      new Request("https://admin.example/api/internal/gateway-heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(heartbeat("gw-1", "pub-1")),
      }),
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ code: "00000", message: "ok" });

    const second = await POST(
      new Request("https://admin.example/api/internal/gateway-heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(heartbeat("gw-1", "pub-2")),
      }),
    );
    expect(second.status).toBe(200);
    expect(memory.rows.size).toBe(1);
    expect(memory.rows.get("gw-1")?.statusJson.domains.find((domain) => domain.domain === "policy")?.version).toBe(
      "pub-2",
    );
  });

  it("drops rows whose last heartbeat is older than seven days", async () => {
    const now = Date.now();
    await memory.repo.upsert({
      instanceId: "stale",
      tenantScope: "",
      lastSeenAt: new Date(now - HEARTBEAT_RETENTION_MS - 60_000),
      updatedAt: new Date(now - HEARTBEAT_RETENTION_MS - 60_000),
      statusJson: {
        instanceId: "stale",
        startedAt: "",
        domains: [],
      } as unknown as GatewayInstanceRow["statusJson"],
    });
    await memory.repo.upsert({
      instanceId: "recent",
      tenantScope: "",
      lastSeenAt: new Date(now - HEARTBEAT_RETENTION_MS + 60_000),
      updatedAt: new Date(now - HEARTBEAT_RETENTION_MS + 60_000),
      statusJson: {
        instanceId: "recent",
        startedAt: "",
        domains: [],
      } as unknown as GatewayInstanceRow["statusJson"],
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example/api/internal/gateway-heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(heartbeat("gw-new", "pub-9")),
      }),
    );
    expect(response.status).toBe(200);
    expect([...memory.rows.keys()].sort()).toEqual(["gw-new", "recent"]);
  });

  it("rejects a body without an instance id", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://admin.example/api/internal/gateway-heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domains: [] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(memory.rows.size).toBe(0);
  });
});
