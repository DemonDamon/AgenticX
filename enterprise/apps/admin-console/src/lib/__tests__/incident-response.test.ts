import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agenticx/iam-core", () => ({
  insertAuditEvent: vi.fn(async () => undefined),
  insertSecurityIncidentAction: vi.fn(
    async (input: Record<string, unknown>) => ({
      id: "act-1",
      ...input,
      createdAt: "2026-11-13T00:00:00.000Z",
    }),
  ),
  getPatHash: vi.fn(async () => "sha256:pat-hash"),
  revokePat: vi.fn(async () => ({ id: 42, name: "leak-pat", status: "revoked" })),
  listPats: vi.fn(async () => [
    { id: 1, name: "p1", status: "active" },
    { id: 2, name: "p2", status: "active" },
  ]),
  listUserSessionIds: vi.fn(async () => ["sess-a", "sess-b"]),
  setUserStatusDisabled: vi.fn(async () => true),
  deleteRefreshSessionBySessionId: vi.fn(async () => undefined),
  recordSessionRevocation: vi.fn(async () => ({
    version: 1,
    revokedSessionIds: ["sess-1"],
    updatedAt: "t",
  })),
  listSecurityIncidentActions: vi.fn(async () => []),
}));

import {
  deleteRefreshSessionBySessionId,
  getPatHash,
  insertAuditEvent,
  listPats,
  listUserSessionIds,
  recordSessionRevocation,
  revokePat,
  setUserStatusDisabled,
} from "@agenticx/iam-core";

import {
  executeIncidentAction,
  IncidentActionError,
} from "../incident-response";

const baseInput = {
  tenantId: "tenant-1",
  incidentId: "inc-1",
  targetId: "sess-1",
  actor: { userId: "u-admin", email: "admin@agx.io" },
};

const gatewayCalls: Array<Record<string, unknown>> = [];
const notifyGateway = vi.fn(async (payload: Record<string, unknown>) => {
  gatewayCalls.push(payload);
});

const blockModel = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  gatewayCalls.length = 0;
});

describe("executeIncidentAction：编排纪律（先审计后动作）", () => {
  it("terminate_session：先 insertAuditEvent → 断 refresh → 写吊销快照 → 调网关", async () => {
    const record = await executeIncidentAction(
      { ...baseInput, action: "terminate_session" },
      { notifyGateway },
    );
    expect(record.outcome).toBe("done");
    const order = vi.mocked(insertAuditEvent).mock.invocationCallOrder[0]!;
    expect(order).toBeLessThan(vi.mocked(deleteRefreshSessionBySessionId).mock.invocationCallOrder[0]!);
    expect(order).toBeLessThan(vi.mocked(recordSessionRevocation).mock.invocationCallOrder[0]!);
    expect(order).toBeLessThan(notifyGateway.mock.invocationCallOrder[0]!);
    expect(vi.mocked(deleteRefreshSessionBySessionId).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(recordSessionRevocation).mock.invocationCallOrder[0]!,
    );
    expect(gatewayCalls[0]).toMatchObject({
      incident_id: "inc-1",
      action: "terminate_session",
      target_type: "session",
      target_id: "sess-1",
      tenant_id: "tenant-1",
    });
  });

  it("revoke_pat：取 hash 并传给网关即时吊销", async () => {
    await executeIncidentAction(
      { ...baseInput, action: "revoke_pat", targetId: "42" },
      { notifyGateway },
    );
    expect(getPatHash).toHaveBeenCalledWith(42, "tenant-1");
    expect(revokePat).toHaveBeenCalledWith(42, "tenant-1");
    expect(gatewayCalls[0]).toMatchObject({
      action: "revoke_pat",
      target_id: "42",
      target_hash: "sha256:pat-hash",
    });
  });

  it("disable_user：无 confirm 拒绝（user 级二次确认）", async () => {
    await expect(
      executeIncidentAction({ ...baseInput, action: "disable_user", targetId: "user-9" }, { notifyGateway }),
    ).rejects.toThrow(/confirm=true/);
    expect(setUserStatusDisabled).not.toHaveBeenCalled();
  });

  it("disable_user：confirm 邮箱不匹配拒绝", async () => {
    await expect(
      executeIncidentAction(
        {
          ...baseInput,
          action: "disable_user",
          targetId: "user-9",
          confirm: true,
          confirmUserEmail: "someone-else@agx.io",
        },
        { notifyGateway },
      ),
    ).rejects.toThrow(/mismatch/);
    expect(setUserStatusDisabled).not.toHaveBeenCalled();
  });

  it("disable_user：确认后级联——禁用用户 + 吊销全部 PAT + 终止全部 session", async () => {
    const record = await executeIncidentAction(
      {
        ...baseInput,
        action: "disable_user",
        targetId: "user-9",
        confirm: true,
        confirmUserEmail: "admin@agx.io",
      },
      { notifyGateway },
    );
    expect(record.outcome).toBe("done");
    expect(setUserStatusDisabled).toHaveBeenCalledWith("tenant-1", "user-9");
    expect(revokePat).toHaveBeenCalledTimes(2);
    expect(listUserSessionIds).toHaveBeenCalledWith("user-9");
    // 2 PAT + 2 session = 4 次网关子动作 + 1 次 user 主动作
    expect(gatewayCalls).toHaveLength(5);
    expect(gatewayCalls[0]).toMatchObject({ action: "disable_user", target_id: "user-9" });
    const subActions = gatewayCalls.slice(1).map((c) => c.action);
    expect(subActions.filter((a) => a === "revoke_pat")).toHaveLength(2);
    expect(subActions.filter((a) => a === "terminate_session")).toHaveLength(2);
  });

  it("block_model：网关落链 + provider enabled=false 执行体", async () => {
    await executeIncidentAction(
      { ...baseInput, action: "block_model", targetId: "prov-x/glm-5.3" },
      { notifyGateway, blockModel },
    );
    expect(gatewayCalls[0]).toMatchObject({
      action: "block_model",
      target_id: "prov-x/glm-5.3",
      target_type: "model",
    });
    expect(blockModel).toHaveBeenCalledWith("tenant-1", "prov-x/glm-5.3");
  });

  it("网关调用失败：动作明细 outcome=failed 且抛错（不静默）", async () => {
    const failing = vi.fn(async () => {
      throw new Error("gateway down");
    });
    await expect(
      executeIncidentAction(
        { ...baseInput, action: "terminate_session" },
        { notifyGateway: failing as never },
      ),
    ).rejects.toBeInstanceOf(IncidentActionError);
    const insertMock = vi.mocked(
      (await import("@agenticx/iam-core")).insertSecurityIncidentAction,
    );
    expect(insertMock).toHaveBeenCalledTimes(1);
    const input = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.outcome).toBe("failed");
    expect(input.detail).toMatchObject({ error: "gateway down" });
  });
});
