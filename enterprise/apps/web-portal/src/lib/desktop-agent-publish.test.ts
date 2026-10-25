import { beforeEach, describe, expect, it, vi } from "vitest";

const listAgentsWithMa = vi.fn();
const getAgentWithMa = vi.fn();
const createAgentWithInitialVersion = vi.fn();
const createAgentVersion = vi.fn();
const previewAgentManifest = vi.fn();
const getAgentVersion = vi.fn();
const updateAgentMaSettings = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  listAgentsWithMa: (...args: unknown[]) => listAgentsWithMa(...args),
  getAgentWithMa: (...args: unknown[]) => getAgentWithMa(...args),
  createAgentWithInitialVersion: (...args: unknown[]) => createAgentWithInitialVersion(...args),
  createAgentVersion: (...args: unknown[]) => createAgentVersion(...args),
  previewAgentManifest: (...args: unknown[]) => previewAgentManifest(...args),
  getAgentVersion: (...args: unknown[]) => getAgentVersion(...args),
  updateAgentMaSettings: (...args: unknown[]) => updateAgentMaSettings(...args),
}));

const input = {
  tenantId: "t1",
  userId: "u1",
  localAvatarId: "Ab-12_X",
  displayName: "周报助手",
  description: "整理周报",
  manifest: { schema: "agx.agent/v1", model: "deepseek/deepseek-chat" },
  note: "第一次提交",
};

function existingAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "ag1",
    origin: "employee",
    ownerUserId: "u1",
    localAvatarId: "Ab-12_X",
    lifecycle: "published",
    versionRouting: "follow_latest",
    effectiveVersion: 3,
    latestVersion: 3,
    ...overrides,
  };
}

describe("publishEmployeeAgentVersion", () => {
  beforeEach(() => {
    listAgentsWithMa.mockReset().mockResolvedValue([]);
    getAgentWithMa.mockReset();
    createAgentWithInitialVersion.mockReset();
    createAgentVersion.mockReset();
    previewAgentManifest.mockReset();
    getAgentVersion.mockReset();
    updateAgentMaSettings.mockReset();
  });

  it("creates a draft employee agent on first publish", async () => {
    createAgentWithInitialVersion.mockResolvedValue({
      agent: {
        id: "ag-new",
        lifecycle: "draft",
        versionRouting: "follow_latest",
        effectiveVersion: 1,
      },
      version: { version: 1 },
    });
    const { publishEmployeeAgentVersion } = await import("./desktop-agent-publish");
    const result = await publishEmployeeAgentVersion(input);
    expect(createAgentWithInitialVersion).toHaveBeenCalledTimes(1);
    const firstCreate = createAgentWithInitialVersion.mock.calls[0];
    const agentInput = firstCreate?.[1];
    const versionInput = firstCreate?.[2];
    expect(agentInput).toMatchObject({
      lifecycle: "draft",
      origin: "employee",
      runtime: "desktop_worker",
      ownerUserId: "u1",
      localAvatarId: "Ab-12_X",
      assignmentKeys: ["u1"],
      workerKeys: ["u1"],
    });
    expect(versionInput).toMatchObject({ source: "desktop", createdBy: "u1" });
    expect(result).toMatchObject({ kind: "ok", status: 201, body: { version: 1, created: true } });
  });

  it("returns created false when manifest hash matches latest", async () => {
    listAgentsWithMa.mockResolvedValue([existingAgent()]);
    previewAgentManifest.mockResolvedValue({ ok: true, normalized: {}, manifestHash: "sha256:same" });
    getAgentVersion.mockResolvedValue({ version: 3, manifestHash: "sha256:same" });
    const { publishEmployeeAgentVersion } = await import("./desktop-agent-publish");
    const result = await publishEmployeeAgentVersion(input);
    expect(result).toMatchObject({
      kind: "ok",
      status: 200,
      body: { created: false, version: 3, agent_id: "ag1" },
    });
    expect(createAgentVersion).not.toHaveBeenCalled();
    expect(updateAgentMaSettings).not.toHaveBeenCalled();
  });

  it("pins routing before adding a version to a published follow_latest agent", async () => {
    listAgentsWithMa.mockResolvedValue([existingAgent()]);
    previewAgentManifest.mockResolvedValue({ ok: true, normalized: {}, manifestHash: "sha256:new" });
    getAgentVersion.mockResolvedValue({ version: 3, manifestHash: "sha256:old" });
    updateAgentMaSettings.mockResolvedValue({});
    createAgentVersion.mockResolvedValue({ version: { version: 4 }, created: true });
    getAgentWithMa.mockResolvedValue({
      id: "ag1",
      lifecycle: "published",
      versionRouting: "pinned",
      effectiveVersion: 3,
      latestVersion: 4,
    });
    const { publishEmployeeAgentVersion } = await import("./desktop-agent-publish");
    const result = await publishEmployeeAgentVersion(input);
    expect(updateAgentMaSettings).toHaveBeenCalledWith("t1", "ag1", {
      versionRouting: "pinned",
      pinnedVersion: 3,
    });
    const pinOrder = updateAgentMaSettings.mock.invocationCallOrder[0] ?? 0;
    const createOrder = createAgentVersion.mock.invocationCallOrder[0] ?? 0;
    expect(pinOrder).toBeLessThan(createOrder);
    expect(result).toMatchObject({
      kind: "ok",
      status: 201,
      body: { version: 4, routing_mode: "pinned", effective_version: 3 },
    });

    listAgentsWithMa.mockResolvedValue([
      existingAgent({ lifecycle: "draft", effectiveVersion: 1, latestVersion: 1 }),
    ]);
    updateAgentMaSettings.mockClear();
    createAgentVersion.mockClear();
    getAgentVersion.mockResolvedValue({ version: 1, manifestHash: "sha256:old" });
    getAgentWithMa.mockResolvedValue({
      id: "ag1",
      lifecycle: "draft",
      versionRouting: "follow_latest",
      effectiveVersion: 1,
      latestVersion: 2,
    });
    await publishEmployeeAgentVersion(input);
    expect(updateAgentMaSettings).not.toHaveBeenCalled();
    expect(createAgentVersion).toHaveBeenCalledTimes(1);
  });

  it("rejects recalled agents", async () => {
    listAgentsWithMa.mockResolvedValue([existingAgent({ lifecycle: "recalled" })]);
    const { publishEmployeeAgentVersion } = await import("./desktop-agent-publish");
    const result = await publishEmployeeAgentVersion(input);
    expect(result).toEqual({ kind: "recalled" });
    expect(createAgentVersion).not.toHaveBeenCalled();
    expect(createAgentWithInitialVersion).not.toHaveBeenCalled();
    expect(updateAgentMaSettings).not.toHaveBeenCalled();
  });

  it("retries once on version conflict", async () => {
    listAgentsWithMa.mockResolvedValue([existingAgent()]);
    previewAgentManifest.mockResolvedValue({ ok: true, normalized: {}, manifestHash: "sha256:new" });
    getAgentVersion.mockResolvedValue({ version: 3, manifestHash: "sha256:old" });
    updateAgentMaSettings.mockResolvedValue({});
    getAgentWithMa.mockResolvedValue({
      id: "ag1",
      lifecycle: "published",
      versionRouting: "pinned",
      effectiveVersion: 3,
      latestVersion: 5,
    });
    createAgentVersion
      .mockRejectedValueOnce({ name: "AgentVersionConflictError" })
      .mockResolvedValueOnce({ version: { version: 6 }, created: true });
    const { publishEmployeeAgentVersion } = await import("./desktop-agent-publish");
    const result = await publishEmployeeAgentVersion(input);
    expect(createAgentVersion).toHaveBeenCalledTimes(2);
    const retryInput = createAgentVersion.mock.calls[1]?.[2] as { expectedLatestVersion?: number } | undefined;
    expect(retryInput?.expectedLatestVersion).toBe(5);
    expect(result).toMatchObject({ kind: "ok", status: 201, body: { version: 6 } });

    createAgentVersion.mockReset();
    createAgentVersion.mockRejectedValue({ name: "AgentVersionConflictError" });
    getAgentWithMa.mockResolvedValue({
      id: "ag1",
      lifecycle: "published",
      versionRouting: "pinned",
      effectiveVersion: 3,
      latestVersion: 7,
    });
    const again = await publishEmployeeAgentVersion(input);
    expect(again).toEqual({ kind: "conflict" });
    expect(createAgentVersion).toHaveBeenCalledTimes(2);
  });

  it("retries slug once on conflict", async () => {
    createAgentWithInitialVersion
      .mockRejectedValueOnce({ name: "AgentSlugConflictError" })
      .mockResolvedValueOnce({
        agent: {
          id: "ag-retry",
          lifecycle: "draft",
          versionRouting: "follow_latest",
          effectiveVersion: 1,
        },
        version: { version: 1 },
      });
    const { publishEmployeeAgentVersion } = await import("./desktop-agent-publish");
    const result = await publishEmployeeAgentVersion(input);
    expect(createAgentWithInitialVersion).toHaveBeenCalledTimes(2);
    const retrySlug = (createAgentWithInitialVersion.mock.calls[1]?.[1] as { slug?: string } | undefined)?.slug ?? "";
    expect(retrySlug).toMatch(/^e[a-z0-9]{1,40}-[a-z0-9]{6}$/);
    expect(result).toMatchObject({ kind: "ok", status: 201 });
  });
});
