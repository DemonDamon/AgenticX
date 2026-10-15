import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const recordHeartbeat = vi.fn();
const listAgents = vi.fn();
const resolveAssignmentKeysForUser = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/worker-tasks", () => ({
  recordHeartbeat: (...args: unknown[]) => recordHeartbeat(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  resolveAssignmentKeysForUser: (...args: unknown[]) => resolveAssignmentKeysForUser(...args),
}));

const IDENTITY = {
  userId: "01USER0AAAAAAAAAAAAAAAAA",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  deptId: "dept-1",
  email: "alice@example.com",
  displayName: "Alice",
  tokenId: 1,
  scopes: ["workspace:chat", "desktop:managed"],
};

function post(body: unknown) {
  return new Request("http://localhost/api/desktop/worker/heartbeat", {
    method: "POST",
    headers: { authorization: "Bearer agx-pat-live", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/worker/heartbeat", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    recordHeartbeat.mockReset();
    listAgents.mockReset();
    resolveAssignmentKeysForUser.mockReset();
    recordHeartbeat.mockResolvedValue(undefined);
    resolveAssignmentKeysForUser.mockResolvedValue(["all", IDENTITY.userId]);
  });

  it("returns 401 without a desktop identity", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { POST } = await import("../heartbeat/route");
    const response = await POST(post({ device_id: "device-a1", device_name: "Near" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "40101" });
    expect(recordHeartbeat).not.toHaveBeenCalled();
  });

  it("returns an empty agent list when the employee cannot run any desktop agent", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    listAgents.mockResolvedValue([
      {
        id: "01AGENT0AAAAAAAAAAAAAAAA",
        slug: "desktop-coder",
        displayName: "桌面助手",
        systemPrompt: "secret",
        model: "demo/coder",
        runtime: "desktop_worker",
        status: "active",
        lifecycle: "published",
        workerKeys: ["dept:other"],
      },
      {
        id: "01AGENT1AAAAAAAAAAAAAAAA",
        slug: "cloud-bot",
        displayName: "云端助手",
        systemPrompt: "secret",
        model: "demo/cloud",
        runtime: "cloud",
        status: "active",
        workerKeys: ["all"],
      },
    ]);
    const { POST } = await import("../heartbeat/route");
    const response = await POST(post({ device_id: "device-a1", device_name: "Near" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agents: [] });
    expect(recordHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "device-a1", agentIds: [] }),
    );
  });
});
